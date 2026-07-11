// Phase 6 (plan-2026-07-10-offline-smarts.md) — the value-free "plan shape".
//
// The self-teaching loop (hit store + AI graduation) remembers WHICH columns and
// WHAT KIND of computation answered a request, so the same wording works offline
// next time. It must remember only the SHAPE — column names, the aggregation,
// the filter operators — and NEVER a cell value, exactly like the Phase 3 alias
// store and the `claudeHint` privacy stance. A remembered "average of
// Duration_days where Drug = amoxicillin" keeps `Duration_days`, `Drug`, and
// `= ` but drops `amoxicillin`, because the drug name is data. The specific
// values are always re-read from the live spreadsheet when the shape is reused,
// never restored from storage.
//
// This module is the single chokepoint both stores go through, so the privacy
// guarantee lives in one tested place.

// The condition fields that describe a filter's SHAPE. Deliberately excludes
// `value`, `values`, `when`, and `term` — all of which can carry a cell value.
function filterShape(condition) {
  if (!condition || !condition.column) return null;
  return { column: condition.column, kind: condition.kind || "value", op: condition.op || "=" };
}

// Extract a value-free shape from a confident offline match (matcher.js). Returns
// { intent, target, group, topN, filters, sheetName } with no cell value anywhere.
export function planShapeFromMatch(match) {
  if (!match || match.status !== "confident") return null;
  const filters = (match.stages || [])
    .map((s) => filterShape(s.condition))
    .filter(Boolean);
  const columns = new Set(filters.map((f) => f.column));

  const shape = {
    intent: match.topN ? "topN" : match.intent || "count",
    target: match.aggregation?.targetColumn || null,
    group: match.aggregation?.groupColumn || match.groupColumn || null,
    topN: match.topN
      ? { column: match.topN.targetColumn, family: match.topN.family, direction: match.topN.direction, n: match.topN.n }
      : null,
    filters,
    sheetName: match.sheetName || null,
  };
  if (shape.target) columns.add(shape.target);
  if (shape.group) columns.add(shape.group);
  if (shape.topN?.column) columns.add(shape.topN.column);
  // Phase 7.5: a Table-1 shape is its set of summarized columns (names only —
  // never a cell value, consistent with the rest of this module).
  if (match.table1?.columns) {
    for (const c of match.table1.columns) columns.add(c);
    shape.table1 = { columns: [...match.table1.columns] };
  }
  shape.columns = [...columns];
  return stripValues(shape);
}

// Extract a value-free shape from a Claude (AI) answer. The AI plan is free-form
// code, not a structured plan, so we take only what is safe and reliable:
//   - the INTENT, detected offline from the user's own wording (average / median
//     / most common / how many …), and
//   - the COLUMN NAMES that appear verbatim in the returned plan text.
// Column names are schema, not data, so they are safe to store; we never read a
// cell value out of the generated code. `detectIntentFor` is injected so this
// module has no import cycle with synonyms.js.
export function planShapeFromAiPlan({ request, plan, headers, detectIntent, detectTopN }) {
  if (!plan || !Array.isArray(headers)) return null;
  const haystack = `${plan.summary || ""}\n${plan.transform_code || ""}\n${planStepsText(plan)}`;
  const columns = headers
    .map((h) => h.name)
    .filter((name) => name && haystack.includes(name));
  if (!columns.length) return null;

  const top = detectTopN ? detectTopN(request) : null;
  const intent = top ? "topN" : (detectIntent ? detectIntent(request)?.intent : null) || "count";
  const shape = {
    intent,
    target: null,
    group: null,
    topN: top ? { column: null, family: top.family, direction: top.direction, n: top.n } : null,
    filters: [],
    columns,
    sheetName: null,
    fromAi: true,
  };
  return stripValues(shape);
}

function planStepsText(plan) {
  if (!Array.isArray(plan.excel_steps)) return "";
  return plan.excel_steps.map((s) => `${s?.title || ""} ${s?.instruction || ""}`).join("\n");
}

// Defensive belt-and-braces: strip any key that could carry a cell value, at any
// depth, before a shape is persisted. The extractors above already omit them;
// this guarantees it even if a caller hand-builds a shape.
const VALUE_KEYS = new Set(["value", "values", "when", "term", "row", "rows", "sample", "example", "examples"]);
export function stripValues(obj) {
  if (Array.isArray(obj)) return obj.map(stripValues);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (VALUE_KEYS.has(k)) continue;
      out[k] = stripValues(v);
    }
    return out;
  }
  return obj;
}
