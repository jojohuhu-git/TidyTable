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
  detectIntent, detectComparator, splitNestedLevels, COHORT_MARKERS,
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
  const col = headers.find((h) => columnKey(h.name).includes(singular) || columnKey(h.name).includes(singular + "id"));
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
  const cohort = extractCohort(request);

  // A cohort question needs either a counting word ("how many", "what share")
  // or a cohort marker ("of patients with…"). Without one of those this is not
  // our kind of request — decline rather than treat stray words as filters.
  if (!intent && !cohort) {
    return { status: "none", reason: "unrecognized", request };
  }

  // Build the remainder after removing the cohort clause, then split into levels.
  let remainder = request;
  if (cohort) remainder = (request.slice(0, cohort.start) + " " + request.slice(cohort.end)).trim();
  const levelTexts = splitNestedLevels(remainder).filter((t) => termWords(t).length > 0);

  // Assemble the ordered filter stages: cohort base first, then each level.
  const rawStages = [];
  if (cohort) rawStages.push({ text: cohort.termText, role: "cohort" });
  for (const t of levelTexts) rawStages.push({ text: t, role: "level" });

  // With no intent and no cohort and no stages, this is not our kind of request.
  if (!intent && !cohort && rawStages.length === 0) {
    return { status: "none", reason: "unrecognized", request };
  }

  const stages = rawStages
    .map((s) => ({ ...s, condition: resolveCondition(s.text, sheet, headers, index, defs) }))
    .filter((s) => s.condition); // drop stages that were pure filler

  const missing = stages.filter((s) => s.condition.kind === "missing").map((s) => s.condition);
  if (missing.length) {
    return {
      status: "needs_definitions",
      missingTerms: missing,
      definitionsPresent: Boolean(defs?.present),
      request,
    };
  }

  if (stages.length === 0) {
    // We caught an intent word but could not pin down what to filter on.
    return { status: "none", reason: "no-conditions", request };
  }

  const grain = detectGrain(request, sheet, headers);
  const grainMode = options.grainMode || null;
  if (grain && !grainMode) {
    return { status: "grain", grain, request };
  }

  return {
    status: "confident",
    intent: intent?.intent || "count",
    stages,
    grain: grainMode === "group-then-test" ? grain : null,
    grainMode: grainMode || "row",
    lookedFor: describeLookedFor(stages, intent, grainMode, grain),
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
export function describeLookedFor(stages, intent, grainMode, grain) {
  const who = grainMode === "group-then-test" && grain ? `${grain.entity}s (combining each one's rows first)` : "rows";
  const lead = intent?.intent === "proportion" ? `Finding the share of ${who}` : `Counting ${who}`;
  const parts = stages.map((s) => conditionPhrase(s.condition));
  return `${lead} where ${parts.join(", then ")}.`;
}
