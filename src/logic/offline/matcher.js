// The offline matcher (build prompt §8). It reads a plain-English cohort question
// against the real data and the user's Definitions sheet, and returns WHAT it
// understood — never a silent guess. Its job is honesty first: every resolved
// filter is spelled back out in `lookedFor`, an unknown clinical term blocks with
// a request for a definition, and a per-patient question over repeating rows
// stops to ask whether to combine rows first.
//
// It does not execute anything — cohort.js runs the resolved stages over the
// rows and fillPlan.js turns a confident match into a PLAN_SCHEMA plan.

import { columnKey } from "../recipes/recipe.js";
import { foldKey } from "../checkup/normalizers.js";
import { lookupDefinition } from "./definitions.js";
import {
  detectIntent, detectComparator, splitNestedLevels, COHORT_MARKERS, GROUP_WORDS,
} from "./synonyms.js";

// Words that carry no filter meaning — stripped before a term is resolved.
const STOP = new Set([
  "how", "many", "much", "number", "count", "of", "the", "a", "an", "any",
  "patients", "patient", "people", "person", "cases", "case", "who", "whom",
  "with", "that", "which", "received", "receive", "receiving", "got", "get",
  "getting", "given", "had", "have", "has", "were", "was", "are", "is", "and",
  "those", "these", "them", "among", "on", "taking", "took", "take", "did",
  "do", "does", "whose", "their", "for", "in", "to", "then", "also", "still",
  "days", "day",
]);

const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);

// Fuzzy-match a spoken column phrase to a real header. Exact fold first, then a
// contained-key match so "duration" finds "Duration_days".
function fuzzyColumn(phrase, headers) {
  const key = columnKey(phrase);
  if (!key) return null;
  let hit = headers.find((h) => columnKey(h.name) === key);
  if (hit) return hit.name;
  hit = headers.find((h) => {
    const hk = columnKey(h.name);
    return hk.includes(key) || key.includes(hk);
  });
  return hit ? hit.name : null;
}

// Precompute, per column, the set of folded cell values so a value scan is quick.
function valueIndex(sheet) {
  const index = new Map(); // header name -> Map(foldedValue -> original value)
  for (const h of sheet.headers) {
    const m = new Map();
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") continue;
      const k = foldKey(v);
      if (!m.has(k)) m.set(k, v);
    }
    index.set(h.name, m);
  }
  return index;
}

// Strip filler words from a clause, keeping only the meaningful term words.
function termWords(clause) {
  return words(clause).filter((w) => !STOP.has(w));
}

// A3 Level 2: pull a "per X"/"by X"/"grouped by X" grouping column out of a
// request. Only fires when the phrase after the marker resolves to a real
// header name — otherwise the marker word almost always belongs to an
// ordinary filter clause ("treated by cephalexin" is a Drug value, not a
// grouping column) and is left for resolveCondition to handle as before.
// Longest marker first so "grouped by"/"broken down by" win over a bare "by"
// inside them.
function resolveGroupBy(text, headers) {
  const markers = [...GROUP_WORDS].sort((a, b) => b.length - a.length);
  for (const marker of markers) {
    const re = new RegExp(`(^|[^a-z])${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index + m[1].length;
    const end = start + marker.length;
    const rest = text.slice(end);
    const stop = rest.search(/,|\bhow many\b|\bhow much\b/i);
    const phraseText = stop === -1 ? rest : rest.slice(0, stop);
    const phrase = termWords(phraseText).join(" ");
    if (!phrase) continue;
    const column = fuzzyColumn(phrase, headers);
    if (column) return { column, start, end: end + (stop === -1 ? rest.length : stop) };
  }
  return null;
}

// A light plural -> singular fallback so "how many different diagnoses"
// matches a "Diagnosis" header. Not a real stemmer — just enough for common
// clinical/business nouns (diagnoses, drugs, prescribers, categories).
function singularize(word) {
  if (/oses$/i.test(word)) return word.slice(0, -4) + "osis"; // diagnoses -> diagnosis
  if (/(ches|shes|xes|sses)$/i.test(word)) return word.slice(0, -2);
  if (/ies$/i.test(word)) return word.slice(0, -3) + "y"; // categories -> category
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

// A3 Level 2: pull the column to sum/average/distinct-count out of a request
// — "average duration_days" -> "Duration_days", "total cost" -> "Cost", "how
// many different diagnoses" -> "Diagnosis". Looks at the words right after the
// matched intent phrase first (the common order), then the words before it.
function resolveAggregationTarget(text, intentPhrase, headers) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(intentPhrase);
  if (idx === -1) return null;
  const after = text.slice(idx + intentPhrase.length);
  const before = text.slice(0, idx);
  for (const candidate of [after, before]) {
    const tw = termWords(candidate);
    if (!tw.length) continue;
    const column = fuzzyColumn(tw.join(" "), headers) || fuzzyColumn(tw.map(singularize).join(" "), headers);
    if (column) return column;
  }
  return null;
}

// Resolve a single filter phrase into a condition, trying (in order): a threshold
// ("... over 7"), a value present in the data (value scan), then the Definitions
// sheet. Anything left over is a missing term the app must refuse to guess.
function resolveCondition(clause, sheet, headers, index, defs) {
  const compar = detectComparator(clause);
  const numMatch = String(clause).match(/-?\d+(?:\.\d+)?/);

  // Threshold: a comparator and a number, on a named column.
  if (compar && numMatch && compar.op !== "=") {
    const before = String(clause).toLowerCase().split(compar.phrase)[0];
    const colPhrase = termWords(before).join(" ");
    const column = fuzzyColumn(colPhrase, headers) || fuzzyColumn(termWords(clause).join(" "), headers);
    if (column) {
      return { kind: "threshold", column, op: compar.op, value: Number(numMatch[0]), source: "column", term: clause.trim() };
    }
  }

  const phrase = termWords(clause).join(" ");
  if (!phrase) return null;

  // Value scan: the phrase (or a word in it) is an actual value in some column.
  for (const h of headers) {
    const m = index.get(h.name);
    if (m.has(foldKey(phrase))) {
      return { kind: "value", column: h.name, op: "=", value: m.get(foldKey(phrase)), source: "value", term: phrase };
    }
  }
  // Try single significant words too ("pyelonephritis" inside a longer clause).
  for (const w of termWords(clause)) {
    for (const h of headers) {
      const m = index.get(h.name);
      if (m.has(foldKey(w))) {
        return { kind: "value", column: h.name, op: "=", value: m.get(foldKey(w)), source: "value", term: w };
      }
    }
  }

  // Definitions sheet — the clinical-knowledge gate.
  const def = lookupDefinition(defs, phrase);
  if (def) {
    const column = def.columnName ? fuzzyColumn(def.columnName, headers) : null;
    if (!column) {
      return { kind: "missing", term: def.term, reason: "definition-column", wantedColumn: def.columnName };
    }
    if (def.kind === "threshold") {
      return {
        kind: "threshold", column, op: def.op, value: def.value, when: def.when,
        source: "definition", term: def.term,
      };
    }
    return { kind: "set", column, op: "in", values: def.values, source: "definition", term: def.term };
  }

  return { kind: "missing", term: phrase, reason: "unknown" };
}

// A2: resolveCondition's single-significant-word fallback can match just one
// word of a compound clause (e.g. "UTI" out of "UTI had duration_days over
// 7") and silently ignore the rest. Wrap it: when the match only consumed
// part of the clause and what's left is significant (a comparator+number, or
// 2+ real words), try to resolve the leftover words as a second condition of
// their own. If that succeeds, both conditions are kept (AND-ed, like a
// nested "of those" level). If it fails, refuse rather than silently drop the
// residue — the caller turns this into a "partial" result.
function resolveConditions(clause, sheet, headers, index, defs) {
  const condition = resolveCondition(clause, sheet, headers, index, defs);
  if (!condition) return [];
  if (condition.kind !== "value" || condition.source !== "value") return [condition];

  const fullWords = termWords(clause);
  const matchedWords = new Set(words(condition.term));
  const residue = fullWords.filter((w) => !matchedWords.has(w));
  if (residue.length === 0) return [condition]; // the whole clause was the value phrase

  const compar = detectComparator(clause);
  const numMatch = String(clause).match(/-?\d+(?:\.\d+)?/);
  const comparWords = compar ? words(compar.phrase) : [];
  const residueHasComparator = Boolean(
    compar && numMatch && compar.op !== "=" && residue.some((w) => comparWords.includes(w) || w === numMatch[0]),
  );
  if (residue.length < 2 && !residueHasComparator) return [condition]; // a stray leftover word, not worth blocking

  const second = resolveCondition(residue.join(" "), sheet, headers, index, defs);
  if (second && (second.kind === "threshold" || second.kind === "value" || second.kind === "set")) {
    return [condition, second];
  }

  return [{ kind: "partial", matched: condition, unmatchedText: residue.join(" "), term: clause.trim() }];
}

// A3 Level 1: the engine only ever counts or shares rows (fillPlan.js has no
// average/sum/group-by math), but "average"/"sum"/"per X"/"by X" leftover
// words used to fall through to resolveCondition and get reported as an
// undefined clinical term ("add a Definitions row for 'average'") — dishonest,
// since no Definitions row could ever satisfy it. Recognize the residue as an
// unsupported-capability request instead, so it declines plainly and logs to
// the miss log (the real signal for what to build next in A3 Level 2).
// A leftover term counts as such residue when it IS the bare aggregation word
// (nothing else left to resolve) or opens with a group-by marker ("per
// diagnosis", "by service", "grouped by clinic") — checked as a prefix so a
// genuine undefined term that merely contains "by" mid-sentence (e.g.
// "confirmed by biopsy") is not swept up by mistake.
function isUnsupportedAggregationResidue(term) {
  const t = String(term || "").trim();
  if (!t) return false;
  const bareIntent = detectIntent(t);
  if (
    bareIntent && (bareIntent.intent === "average" || bareIntent.intent === "sum")
    && words(t).length === words(bareIntent.phrase).length
  ) {
    return true;
  }
  const lower = t.toLowerCase();
  return GROUP_WORDS.some((g) => lower === g || lower.startsWith(`${g} `));
}

// Pull the base cohort clause out ("of patients with pyelonephritis"). Returns
// { term, start, end } describing the term phrase and where the whole clause sits
// in the original text, or null.
function extractCohort(request) {
  const lower = request.toLowerCase();
  let best = null;
  for (const marker of COHORT_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx !== -1 && (!best || idx < best.markerIdx || (idx === best.markerIdx && marker.length > best.marker.length))) {
      best = { marker, markerIdx: idx };
    }
  }
  if (!best) return null;
  const afterIdx = best.markerIdx + best.marker.length;
  const rest = request.slice(afterIdx);
  // The cohort term ends at the first comma or the next "how many" clause.
  const stop = rest.search(/,|\bhow many\b|\bhow much\b/i);
  const termText = stop === -1 ? rest : rest.slice(0, stop);
  return { termText, start: best.markerIdx, end: afterIdx + (stop === -1 ? rest.length : stop) };
}

// Detect a per-entity question over repeating rows (grain). If the user asks
// "how many patients…" and the patient column really does repeat, a row-mode
// count would double-count — so we flag it for a clarifying question.
function detectGrain(request, sheet, headers) {
  const w = new Set(words(request));
  const entities = ["patient", "patients", "person", "people", "prescriber", "prescribers"];
  const asked = entities.find((e) => w.has(e));
  if (!asked) return null;
  const singular = asked.replace(/s$/, "");
  let col = headers.find((h) => columnKey(h.name).includes(singular) || columnKey(h.name).includes(singular + "id"));

  // NEW-4: the file's per-entity key is often not named after the entity at
  // all (e.g. an encounter ID "CSN" when the question asks about patients).
  // Fall back to any ID-like column (almost every value unique) that still
  // has at least one repeat — the same "ID-like" heuristic scan.js uses for
  // findDuplicateIds — rather than silently assuming the row grain is right.
  if (!col) {
    for (const h of headers) {
      const vals = sheet.rows.map((r) => r[h.name]).filter((v) => v != null && String(v).trim() !== "");
      if (vals.length < 4) continue;
      const distinctCount = new Set(vals.map(foldKey)).size;
      if (distinctCount / vals.length < 0.9) continue; // not ID-like enough
      if (distinctCount === vals.length) continue; // no repeats — no grain issue
      col = h;
      break;
    }
  }
  if (!col) return null;
  const seen = new Set();
  let repeats = false;
  for (const r of sheet.rows) {
    const v = r[col.name];
    if (v == null) continue;
    const k = foldKey(v);
    if (seen.has(k)) { repeats = true; break; }
    seen.add(k);
  }
  if (!repeats) return null;
  return {
    entityColumn: col.name,
    entity: singular,
    question: `Each ${singular} appears on more than one row in "${col.name}". Should I combine each ${singular}'s rows first, then count who meets what you asked? Otherwise I would count rows, not ${asked}.`,
  };
}

// Public: read a request. options.grainMode = "row" | "group-then-test" | null.
// Returns a result whose `status` drives the UI:
//   "none"             — nothing recognizable; offer Claude / decline, log a miss
//   "needs_definitions"— a clinical term is undefined; block and ask for it
//   "grain"            — per-entity question over repeating rows; ask to combine
//   "confident"        — understood; run it, but always show `lookedFor`
export function matchRequest(request, workbook, defs, options = {}) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet) return { status: "none", reason: "no-data" };
  const headers = sheet.headers;
  const index = valueIndex(sheet);

  const intent = detectIntent(request);

  // A3 Level 2: resolve a "per X"/"by X"/"grouped by X" breakdown column
  // first, against the raw request, and strip its clause out before looking
  // for a cohort clause. A cohort clause is greedy (everything up to a comma
  // or "how many"), so resolving it first would swallow a trailing group-by
  // phrase as if it were part of the filter term (e.g. "of patients with UTI
  // per drug" would otherwise read "UTI per drug" as one filter phrase).
  const groupBy = resolveGroupBy(request, headers);
  const preCohortText = groupBy ? (request.slice(0, groupBy.start) + " " + request.slice(groupBy.end)).trim() : request;
  const cohort = extractCohort(preCohortText);

  // A3 Level 2: average/sum/distinct try to resolve a real numeric/target
  // column before anything else. Only decline outright (as Level 1 did) when
  // no column can be pinned down — a genuinely unresolvable aggregation
  // request still gets the honest capability message, but "average
  // duration_days [for patients with X] [per Y]" now actually computes.
  if (intent && (intent.intent === "average" || intent.intent === "sum" || intent.intent === "distinct")) {
    // Search for the target column with any cohort clause ("for patients with
    // UTI") stripped out too, so its words don't get glued onto the target
    // phrase and break the fuzzy column match.
    const targetSearchText = cohort ? (preCohortText.slice(0, cohort.start) + " " + preCohortText.slice(cohort.end)).trim() : preCohortText;
    const targetColumn = resolveAggregationTarget(targetSearchText, intent.phrase, headers);
    if (!targetColumn) {
      return { status: "none", reason: `unsupported-${intent.intent}`, request };
    }
    return matchAggregation(request, intent, targetColumn, cohort, groupBy, sheet, headers, index, defs);
  }

  // A cohort question needs either a counting word ("how many", "what share")
  // or a cohort marker ("of patients with…"). Without one of those this is not
  // our kind of request — decline rather than treat stray words as filters.
  if (!intent && !cohort) {
    return { status: "none", reason: "unrecognized", request };
  }

  // Build the remainder after removing the cohort clause, then split into levels.
  let remainder = preCohortText;
  if (cohort) remainder = (preCohortText.slice(0, cohort.start) + " " + preCohortText.slice(cohort.end)).trim();

  const levelTexts = splitNestedLevels(remainder).filter((t) => termWords(t).length > 0);

  // Assemble the ordered filter stages: cohort base first, then each level.
  const rawStages = [];
  if (cohort) rawStages.push({ text: cohort.termText, role: "cohort" });
  for (const t of levelTexts) rawStages.push({ text: t, role: "level" });

  // With no intent, no cohort, no group-by and no stages, this is not our kind of request.
  if (!intent && !cohort && !groupBy && rawStages.length === 0) {
    return { status: "none", reason: "unrecognized", request };
  }

  const stages = rawStages
    .flatMap((s) => resolveConditions(s.text, sheet, headers, index, defs).map((condition) => ({ ...s, condition })))
    .filter((s) => s.condition); // drop stages that were pure filler

  const partial = stages.find((s) => s.condition.kind === "partial");
  if (partial) {
    return {
      status: "partial",
      understood: partial.condition.matched,
      unmatchedText: partial.condition.unmatchedText,
      clause: partial.condition.term,
      request,
    };
  }

  const missing = stages.filter((s) => s.condition.kind === "missing").map((s) => s.condition);
  if (missing.length) {
    // A3 Level 1: if every unresolved term is a group-by residue ("per
    // diagnosis", "by service") rather than a genuine undefined clinical
    // term, this is a capability gap, not a missing definition — decline
    // honestly instead of asking for a Definitions row that could never help.
    if (missing.every((m) => m.reason === "unknown" && isUnsupportedAggregationResidue(m.term))) {
      return { status: "none", reason: "unsupported-groupby", request };
    }
    return {
      status: "needs_definitions",
      missingTerms: missing,
      definitionsPresent: Boolean(defs?.present),
      request,
    };
  }

  if (stages.length === 0 && !groupBy) {
    // We caught an intent word but could not pin down what to filter on.
    return { status: "none", reason: "no-conditions", request };
  }

  // A group-by breakdown counts rows per group directly; the per-patient grain
  // question ("combine each patient's rows first?") is about a plain count,
  // not a breakdown, so skip it once a group-by has already been resolved.
  const grain = groupBy ? null : detectGrain(request, sheet, headers);
  const grainMode = options.grainMode || null;
  if (grain && !grainMode) {
    return { status: "grain", grain, request };
  }

  return {
    status: "confident",
    intent: intent?.intent || "count",
    stages,
    groupColumn: groupBy?.column || null,
    grain: grainMode === "group-then-test" ? grain : null,
    grainMode: grainMode || "row",
    lookedFor: describeLookedFor(stages, intent, grainMode, grain, groupBy),
    sheetName: sheet.name,
  };
}

// A3 Level 2: resolve an average/sum/distinct request once a target column is
// pinned down. Reuses the same cohort/filter machinery a plain count uses —
// nested "of those" nesting is out of scope for an aggregation, so only the
// cohort clause (if any) becomes a filter stage.
function matchAggregation(request, intent, targetColumn, cohort, groupBy, sheet, headers, index, defs) {
  const rawStages = [];
  if (cohort) rawStages.push({ text: cohort.termText, role: "cohort" });

  const stages = rawStages
    .flatMap((s) => resolveConditions(s.text, sheet, headers, index, defs).map((condition) => ({ ...s, condition })))
    .filter((s) => s.condition);

  const partial = stages.find((s) => s.condition.kind === "partial");
  if (partial) {
    return {
      status: "partial",
      understood: partial.condition.matched,
      unmatchedText: partial.condition.unmatchedText,
      clause: partial.condition.term,
      request,
    };
  }

  const missing = stages.filter((s) => s.condition.kind === "missing").map((s) => s.condition);
  if (missing.length) {
    return {
      status: "needs_definitions",
      missingTerms: missing,
      definitionsPresent: Boolean(defs?.present),
      request,
    };
  }

  return {
    status: "confident",
    intent: intent.intent,
    aggregation: { targetColumn, groupColumn: groupBy?.column || null },
    stages,
    grainMode: "row",
    lookedFor: describeLookedForAggregation(intent.intent, targetColumn, stages, groupBy),
    sheetName: sheet.name,
  };
}

export function conditionPhrase(c) {
  if (c.kind === "threshold") return `"${c.column}" is ${opWord(c.op)} ${c.value}`;
  if (c.kind === "set") return `"${c.column}" is one of ${c.values.join(", ")}`;
  return `"${c.column}" is ${c.value}`;
}

function opWord(op) {
  return { ">=": "at least", "<=": "at most", ">": "over", "<": "under", "<>": "not", "=": "" }[op] || op;
}

// The trust panel line (build prompt §8, §12): spell the filters back so a wrong
// guess is visible before anyone trusts the number.
export function describeLookedFor(stages, intent, grainMode, grain, groupBy) {
  const who = grainMode === "group-then-test" && grain ? `${grain.entity}s (combining each one's rows first)` : "rows";
  const lead = intent?.intent === "proportion" ? `Finding the share of ${who}` : `Counting ${who}`;
  const parts = stages.map((s) => conditionPhrase(s.condition));
  const where = parts.length ? ` where ${parts.join(", then ")}` : "";
  const brokenDown = groupBy ? `, broken down by "${groupBy.column}"` : "";
  return `${lead}${where}${brokenDown}.`;
}

// A3 Level 2: the trust panel line for an average/sum/distinct request.
export function describeLookedForAggregation(aggIntent, targetColumn, stages, groupBy) {
  const verb = { sum: "Adding up", average: "Averaging", distinct: "Counting the distinct values of" }[aggIntent] || "Computing";
  const parts = stages.map((s) => conditionPhrase(s.condition));
  const where = parts.length ? ` where ${parts.join(", then ")}` : "";
  const brokenDown = groupBy ? `, broken down by "${groupBy.column}"` : "";
  return `${verb} "${targetColumn}"${where}${brokenDown}.`;
}
