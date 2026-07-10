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
  expandClinicalSynonyms,
} from "./synonyms.js";
import { findValueCandidates, findColumnCandidates, nearestSuggestions } from "./valueMatch.js";

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

// W2c: recognize a trailing column hint like "in urine", "under Urine
// Organisms", "from ward", or "<phrase> column". Returns { columns, hintText,
// stretched } when the hint resolves to one or more real headers, or null. Only
// the LAST such phrase is treated as a column scope, since it's the natural
// place a scope lands ("... E. coli in urine"). If the hinted phrase is itself a
// cell value, we do NOT scope on it — the caller then treats it as a value, so
// nothing is double-counted.
function resolveColumnScope(clause, headers, index) {
  const text = String(clause);
  // "<phrase> column" — an explicit column word.
  let m = /\b([a-z0-9][a-z0-9 _-]*?)\s+column\b/i.exec(text);
  let hintPhrase = null;
  let hintText = null;
  if (m) { hintPhrase = m[1].trim(); hintText = m[0]; }
  if (!hintPhrase) {
    // "in|under|from|within <phrase>" — take the last occurrence.
    const re = /\b(?:in|under|from|within)\s+([a-z0-9][a-z0-9 _-]*)$/i;
    const mm = re.exec(text.trim());
    if (mm) { hintPhrase = mm[1].trim(); hintText = mm[0]; }
  }
  if (!hintPhrase) return null;

  const phrase = termWords(hintPhrase).join(" ");
  if (!phrase) return null;

  // If the hint phrase is itself a cell value somewhere, it's a value, not a
  // scope — leave it for the value scan (current behavior), never double-count.
  const asValue = findValueCandidates(phrase, headers, index);
  if (asValue.some((c) => c.exact)) return null;

  // Exact header match first (no stretch), then the token-subset tier.
  const exact = fuzzyColumn(phrase, headers);
  if (exact) return { columns: [exact], hintText, hintPhrase, stretched: false };
  const fuzzy = findColumnCandidates(phrase, headers);
  if (fuzzy.length) return { columns: fuzzy, hintText, hintPhrase, stretched: true };
  return null;
}

// Turn a resolved value candidate into a value condition, carrying the real cell
// value so every downstream surface (execution, Excel steps, transform) stays
// identical to a plain exact match. `stretched`/`candidates` drive the middle-
// path "Did you mean…?" confirmation upstream.
function valueCondition(candidate, term, { stretched, candidates, via, scopeWords } = {}) {
  return {
    kind: "value", column: candidate.column, op: "=", value: candidate.value,
    source: "value", term,
    stretched: Boolean(stretched),
    ...(candidates && candidates.length > 1 ? { candidates } : {}),
    ...(via ? { via } : {}),
    // W2c: words consumed by a column scope ("in urine"), so the residue check
    // in resolveConditions doesn't treat them as a leftover second condition.
    ...(scopeWords && scopeWords.length ? { scopeWords } : {}),
  };
}

// Resolve a single filter phrase into a condition, trying (in order): a threshold
// ("... over 7"), a column scope ("... in urine"), an exact/fuzzy value present
// in the data (value scan), a clinical-abbreviation expansion, then the
// Definitions sheet. Anything left over is a missing term the app must refuse to
// guess — but it comes back with the nearest values/columns it CAN see, so the
// user isn't just told to reach for AI. `aliasMap` remembers phrases the user
// already confirmed this session, so the same stretch never asks twice.
function resolveCondition(clause, sheet, headers, index, defs, aliasMap) {
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

  // W2c: peel off a trailing "in <column>" / "<phrase> column" scope, and drop
  // its words from the value phrase so "e coli in urine" searches for "e coli".
  const scope = resolveColumnScope(clause, headers, index);
  const scopeColumns = scope ? scope.columns : null;
  const scopeStretched = scope ? scope.stretched : false;
  let valueClause = clause;
  let scopeWords = [];
  if (scope && scope.hintText) {
    valueClause = String(clause).replace(scope.hintText, " ");
    // Every real word inside the scope hint ("urine organisms" from "in urine
    // organisms") is consumed by the scope, not left over as a value.
    scopeWords = termWords(scope.hintText);
  }

  const phrase = termWords(valueClause).join(" ");
  if (!phrase) {
    // The clause was ONLY a column scope with no value to look for — nothing to
    // filter on. Let the caller report it as filler rather than a bad guess.
    return null;
  }

  // W2d: a mapping the user already confirmed this session wins immediately, no
  // stretch, no re-ask.
  const aliasKey = foldKey(phrase);
  if (aliasMap && aliasMap.has(aliasKey)) {
    const a = aliasMap.get(aliasKey);
    return valueCondition(a, phrase, { stretched: false, scopeWords });
  }

  const scanColumns = scopeColumns;

  // Run a scan against the scoped column first (W2c); if it finds nothing there,
  // fall back to all columns and flag the fall-back so it counts as a stretch.
  // Returns { candidates, scopedFellBack }.
  const scan = (text) => {
    if (scanColumns) {
      const scoped = findValueCandidates(text, headers, index, { columns: scanColumns });
      if (scoped.length) return { candidates: scoped, scopedFellBack: false };
      const all = findValueCandidates(text, headers, index);
      return { candidates: all, scopedFellBack: all.length > 0 };
    }
    return { candidates: findValueCandidates(text, headers, index), scopedFellBack: false };
  };

  // Tier 1 — an exact whole-phrase value (or a single exact word of a longer
  // clause). Both are the old, no-stretch behavior: answer directly. The word
  // pass keeps "pyelonephritis" resolvable inside "UTI pyelonephritis" without
  // demanding the whole clause be one value.
  const whole = scan(phrase);
  const wholeExact = whole.candidates.find((c) => c.exact);
  if (wholeExact && !whole.scopedFellBack && !scopeStretched) {
    return valueCondition(wholeExact, phrase, { stretched: false, scopeWords });
  }
  for (const w of termWords(valueClause)) {
    const one = scan(w);
    const oneExact = one.candidates.find((c) => c.exact);
    if (oneExact && !one.scopedFellBack && !scopeStretched) {
      return valueCondition(oneExact, w, { stretched: false, scopeWords });
    }
  }

  // Tier 2 — the token-subset / prefix tier (W2a): "e coli" -> "ESCHERICHIA
  // COLI", or a scoped/ambiguous match. Anything here is a stretch to confirm.
  const { candidates, scopedFellBack } = scan(phrase);
  if (candidates.length) {
    const top = candidates[0];
    const strongTies = candidates.filter((c) => c.score === top.score);
    return valueCondition(top, phrase, {
      stretched: true, candidates: strongTies.slice(0, 3), scopeWords,
    });
  }

  // W2b: try clinical-abbreviation expansions ("e coli" -> "escherichia coli"),
  // still restricted to the scoped column first. An expansion is ALWAYS a
  // stretch (confirm before answering).
  for (const expanded of expandClinicalSynonyms(phrase)) {
    let exCands = scanColumns
      ? findValueCandidates(expanded, headers, index, { columns: scanColumns })
      : [];
    if (!exCands.length) exCands = findValueCandidates(expanded, headers, index);
    if (exCands.length) {
      const top = exCands[0];
      return valueCondition(top, phrase, {
        stretched: true,
        candidates: exCands.filter((c) => c.score === top.score).slice(0, 3),
        via: `expanded "${phrase}" to "${expanded}"`,
        scopeWords,
      });
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

  // W2e: nothing resolved. Refuse to guess, but hand back the nearest values and
  // columns so the UI can offer them as chips instead of just "use AI".
  return { kind: "missing", term: phrase, reason: "unknown", nearest: nearestSuggestions(phrase, headers, index) };
}

// A2: resolveCondition's single-significant-word fallback can match just one
// word of a compound clause (e.g. "UTI" out of "UTI had duration_days over
// 7") and silently ignore the rest. Wrap it: when the match only consumed
// part of the clause and what's left is significant (a comparator+number, or
// 2+ real words), try to resolve the leftover words as a second condition of
// their own. If that succeeds, both conditions are kept (AND-ed, like a
// nested "of those" level). If it fails, refuse rather than silently drop the
// residue — the caller turns this into a "partial" result.
function resolveConditions(clause, sheet, headers, index, defs, aliasMap) {
  const condition = resolveCondition(clause, sheet, headers, index, defs, aliasMap);
  if (!condition) return [];
  if (condition.kind !== "value" || condition.source !== "value") return [condition];

  const fullWords = termWords(clause);
  // W2c: words consumed by the value phrase AND by any column scope ("in urine")
  // are accounted for — only genuinely leftover words count as residue.
  const matchedWords = new Set([...words(condition.term), ...(condition.scopeWords || [])]);
  const residue = fullWords.filter((w) => !matchedWords.has(w));
  if (residue.length === 0) return [condition]; // the whole clause was the value phrase

  const compar = detectComparator(clause);
  const numMatch = String(clause).match(/-?\d+(?:\.\d+)?/);
  const comparWords = compar ? words(compar.phrase) : [];
  const residueHasComparator = Boolean(
    compar && numMatch && compar.op !== "=" && residue.some((w) => comparWords.includes(w) || w === numMatch[0]),
  );
  if (residue.length < 2 && !residueHasComparator) return [condition]; // a stray leftover word, not worth blocking

  const second = resolveCondition(residue.join(" "), sheet, headers, index, defs, aliasMap);
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

// W2d: if any resolved stage is a stretch (abbreviation, prefix/token-subset
// value match, fuzzy column scope, or a tie between candidates), return a
// "needs_confirm" result the UI turns into a "Did you mean…?" box. The first
// stretched stage is the one to confirm; its `candidates` (already the top 2–3)
// become the answer buttons, and `phrase` is the exact wording the user typed
// so the confirmed choice can be remembered against it. An exact, single,
// unstretched match returns null → answer immediately.
// Strip the W2-only annotation fields (stretched/candidates/via/scopeWords) off
// a resolved condition once it's confirmed, so the executed plan and its
// serialized transform stay byte-for-byte what they were before W2 — the
// execution surfaces only ever read kind/column/op/value/values/when.
function cleanCondition(c) {
  const { stretched, candidates, via, scopeWords, ...rest } = c;
  void stretched; void candidates; void via; void scopeWords;
  return rest;
}
function cleanStages(stages) {
  return stages.map((s) => ({ ...s, condition: cleanCondition(s.condition) }));
}

function buildConfirmation(stages, request) {
  const stretchedStage = stages.find((s) => s.condition.kind === "value" && s.condition.stretched);
  if (!stretchedStage) return null;
  const c = stretchedStage.condition;
  const candidates = (c.candidates && c.candidates.length ? c.candidates : [{ column: c.column, value: c.value }])
    .map((x) => ({ column: x.column, value: x.value }));
  return {
    status: "needs_confirm",
    phrase: c.term,
    candidates,
    via: c.via || null,
    request,
  };
}

// Public: read a request. options.grainMode = "row" | "group-then-test" | null.
// Returns a result whose `status` drives the UI:
//   "none"             — nothing recognizable; offer Claude / decline, log a miss
//   "needs_definitions"— a clinical term is undefined; block and ask for it
//   "needs_confirm"    — the app stretched to reach a value; confirm before answering
//   "grain"            — per-entity question over repeating rows; ask to combine
//   "confident"        — understood; run it, but always show `lookedFor`
export function matchRequest(request, workbook, defs, options = {}) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet) return { status: "none", reason: "no-data" };
  const headers = sheet.headers;
  const index = valueIndex(sheet);
  // W2d: phrase (folded) -> confirmed { column, value } from an earlier "Did you
  // mean…?" answer this session, so the same stretch never asks twice. Passed
  // in by runOffline from App-level session state.
  const aliasMap = options.aliasMap instanceof Map
    ? options.aliasMap
    : new Map(Object.entries(options.aliasMap || {}));

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
    return matchAggregation(request, intent, targetColumn, cohort, groupBy, sheet, headers, index, defs, aliasMap);
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
    .flatMap((s) => resolveConditions(s.text, sheet, headers, index, defs, aliasMap).map((condition) => ({ ...s, condition })))
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

  // W2d middle path: if the app had to STRETCH to reach any value (an
  // abbreviation, a prefix/token-subset match, a column-scope fuzzy match, or
  // more than one equally-strong candidate), confirm before answering.
  const confirm = buildConfirmation(stages, request);
  if (confirm) return confirm;

  // A group-by breakdown counts rows per group directly; the per-patient grain
  // question ("combine each patient's rows first?") is about a plain count,
  // not a breakdown, so skip it once a group-by has already been resolved.
  const grain = groupBy ? null : detectGrain(request, sheet, headers);
  const grainMode = options.grainMode || null;
  if (grain && !grainMode) {
    return { status: "grain", grain, request };
  }

  const cleanedStages = cleanStages(stages);
  return {
    status: "confident",
    intent: intent?.intent || "count",
    stages: cleanedStages,
    groupColumn: groupBy?.column || null,
    grain: grainMode === "group-then-test" ? grain : null,
    grainMode: grainMode || "row",
    lookedFor: describeLookedFor(cleanedStages, intent, grainMode, grain, groupBy),
    sheetName: sheet.name,
  };
}

// A3 Level 2: resolve an average/sum/distinct request once a target column is
// pinned down. Reuses the same cohort/filter machinery a plain count uses —
// nested "of those" nesting is out of scope for an aggregation, so only the
// cohort clause (if any) becomes a filter stage.
function matchAggregation(request, intent, targetColumn, cohort, groupBy, sheet, headers, index, defs, aliasMap) {
  const rawStages = [];
  if (cohort) rawStages.push({ text: cohort.termText, role: "cohort" });

  const stages = rawStages
    .flatMap((s) => resolveConditions(s.text, sheet, headers, index, defs, aliasMap).map((condition) => ({ ...s, condition })))
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

  const confirm = buildConfirmation(stages, request);
  if (confirm) return confirm;

  const cleanedStages = cleanStages(stages);
  return {
    status: "confident",
    intent: intent.intent,
    aggregation: { targetColumn, groupColumn: groupBy?.column || null },
    stages: cleanedStages,
    grainMode: "row",
    lookedFor: describeLookedForAggregation(intent.intent, targetColumn, cleanedStages, groupBy),
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
