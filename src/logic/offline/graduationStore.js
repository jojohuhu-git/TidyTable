// Phase 6 (plan-2026-07-10-offline-smarts.md) — AI graduation.
//
// When Claude answers a Step-3 request the offline engine could not, we remember
// the value-free SHAPE of that answer (see planShape.js) keyed by the user's
// exact wording, per file shape (signature) — the same per-file keying the alias
// store and recipes use, so a template learned for one spreadsheet's columns
// never bleeds onto an unrelated file. The next time the SAME wording is asked on
// a file of that shape, the offline engine reconstructs the computation locally
// and answers with no API key — the AI's vocabulary for this owner's real files
// gradually "graduates" into the offline engine.
//
// PRIVACY: this store holds only column names, the aggregation, and filter
// operators — never a cell value (planShape.js is the enforced chokepoint). The
// actual filter values are always re-read from the live sheet when a shape is
// reused, never restored from storage.

import { fileSignature, aliasKey, signatureDistance, NEAR_MATCH_MAX_DISTANCE } from "./aliasStore.js";
import { describeLookedForAggregation, describeLookedForTopN } from "./matcher.js";
import { stripValues } from "./planShape.js";

export const GRADUATION_STORE_VERSION = 1;
const STORE_KEY = "tidytable_graduation";

// Header types an average/sum/etc. can honestly run on — mirrors matcher.js's
// NUMERIC_COLUMN_TYPES so a graduated shape can't reconstruct a numeric stat on
// a text column (Phase 1's honesty gate, preserved on the graduation path).
const NUMERIC_COLUMN_TYPES = new Set(["number", "mixed (text + numbers)"]);
const NUMERIC_STAT_INTENTS = new Set(["sum", "average", "median", "quartiles", "stdev", "min", "max", "range", "describe"]);

export function emptyGraduationStore() {
  return { version: GRADUATION_STORE_VERSION, files: {} };
}

// Remember request -> value-free shape for a file shape, returning a NEW store.
// The shape is run through stripValues one more time here so nothing sensitive
// can reach storage even if a caller hand-built the shape.
export function rememberGraduation(store, signature, request, shape) {
  const base = store && store.files ? store : emptyGraduationStore();
  const key = aliasKey(request);
  if (!signature || !key || !shape) return base;
  const files = { ...base.files };
  files[signature] = { ...(files[signature] || {}), [key]: stripValues(shape) };
  return { version: GRADUATION_STORE_VERSION, files };
}

export function graduationFor(store, signature, request) {
  if (!store || !signature) return null;
  const entry = store.files?.[signature]?.[aliasKey(request)];
  return entry || null;
}

// P4-1: same near-match search as columnAliasesFor (aliasStore.js) — a
// graduated shape learned for one file shape should still apply after next
// month's export adds or renames one column, but a shape learned on a
// genuinely different file must not silently apply just because a phrase or
// column name happens to coincide. Declines (returns null) if two shapes at
// the same nearest distance disagree, rather than guessing which one is right.
function nearestGraduationFor(store, headers, request) {
  if (!store || !Array.isArray(headers) || !headers.length) return null;
  const currentSignature = fileSignature(headers);
  const key = aliasKey(request);
  let best = null; // { shape, dist }
  let ambiguous = false;
  for (const [storedSignature, phraseMap] of Object.entries(store.files || {})) {
    const dist = signatureDistance(storedSignature, currentSignature);
    if (dist > NEAR_MATCH_MAX_DISTANCE) continue;
    const shape = phraseMap && phraseMap[key];
    if (!shape) continue;
    if (!best || dist < best.dist) {
      best = { shape, dist };
      ambiguous = false;
    } else if (dist === best.dist && JSON.stringify(shape) !== JSON.stringify(best.shape)) {
      ambiguous = true;
    }
  }
  if (!best || ambiguous) return null;
  return best.shape;
}

// --- reconstruct an executable, confident match from a stored shape ----------
//
// Only shapes with NO filters are auto-answered: an aggregation/top-N/distinct
// over a whole column needs no cell value at all, so it is fully reconstructable
// offline and cannot leak or misremember a value. A shape that carried filters
// is remembered for the owner's curation but is NOT auto-answered, because its
// specific values would have to be re-resolved and confirmed — honest silence
// beats a confident re-guess. Returns a matcher-shaped "confident" match, or null.
export function applyGraduation(store, request, workbook) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet) return null;
  const headers = sheet.headers;
  const shape = nearestGraduationFor(store, headers, request);
  if (!shape) return null;
  if (Array.isArray(shape.filters) && shape.filters.length) return null; // filtered → don't auto-answer

  const hasCol = (name) => name && headers.some((h) => h.name === name);
  const isNumeric = (name) => {
    const h = headers.find((x) => x.name === name);
    return h && h.type && NUMERIC_COLUMN_TYPES.has(h.type);
  };

  // Resolve the target column: a precise one from an offline-derived shape, or
  // the sole referenced numeric column from an AI-derived shape (ambiguous → no
  // auto-answer, which keeps the "0 confident-wrong" guarantee).
  const resolveTarget = () => {
    if (hasCol(shape.target)) return shape.target;
    const numericRefs = (shape.columns || []).filter((c) => hasCol(c) && isNumeric(c));
    return numericRefs.length === 1 ? numericRefs[0] : null;
  };

  // top-N ranking
  if (shape.intent === "topN" && shape.topN) {
    const col = hasCol(shape.topN.column)
      ? shape.topN.column
      : (shape.columns || []).find((c) => hasCol(c));
    if (!col) return null;
    if (shape.topN.family === "magnitude" && !isNumeric(col)) return null; // honesty gate
    const topN = { targetColumn: col, direction: shape.topN.direction || "most", n: shape.topN.n ?? (shape.topN.family === "magnitude" ? 1 : Infinity), family: shape.topN.family || "frequency" };
    return {
      status: "confident",
      intent: "topN",
      topN,
      stages: [],
      grainMode: "row",
      lookedFor: describeLookedForTopN(topN, []),
      sheetName: sheet.name,
      graduated: true,
    };
  }

  // distinct count works on any column type
  if (shape.intent === "distinct") {
    const col = hasCol(shape.target) ? shape.target : (shape.columns || []).find((c) => hasCol(c));
    if (!col) return null;
    return aggMatch("distinct", col, shape.group, sheet, headers);
  }

  // describe + numeric stats need a numeric target
  if (NUMERIC_STAT_INTENTS.has(shape.intent)) {
    const target = resolveTarget();
    if (!target || !isNumeric(target)) return null;
    return aggMatch(shape.intent, target, shape.group, sheet, headers);
  }

  return null;
}

function aggMatch(intent, target, group, sheet, headers) {
  const groupColumn = group && headers.some((h) => h.name === group) ? group : null;
  const isDescribe = intent === "describe";
  return {
    status: "confident",
    intent,
    aggregation: { targetColumn: target, groupColumn },
    stages: [],
    grainMode: "row",
    lookedFor: describeLookedForAggregation(intent, target, [], groupColumn ? { column: groupColumn } : null),
    sheetName: sheet.name,
    graduated: true,
    ...(isDescribe ? {} : {}),
  };
}

// --- localStorage round-trip (kept apart from misses / aliases / recipes) -----

export function loadGraduationStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyGraduationStore();
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || typeof obj.files !== "object") return emptyGraduationStore();
    return { version: GRADUATION_STORE_VERSION, files: obj.files };
  } catch {
    return emptyGraduationStore();
  }
}

export function persistGraduationStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store || emptyGraduationStore()));
  } catch {
    // storage full / unavailable — graduation is a convenience, never critical.
  }
  return store;
}
