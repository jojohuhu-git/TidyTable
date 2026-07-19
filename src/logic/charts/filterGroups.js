// Item 7 (plan-echo builder): equality-only filter conditions organized into
// AND-groups, combined with OR across groups — e.g. "(Drug=cephalexin AND
// Diagnosis=cystitis) OR (Drug=amoxicillin AND Diagnosis=UTI)". No AND/OR
// combinator like this existed before item 7 — cohort.js's match.stages is a
// flat AND-chain only. Reuses cohort.js's predicate() for the actual equality
// test (foldKey-based, same as everywhere else in the app) rather than
// reimplementing it, so there is one source of truth for "does this row match
// column=value".

import { foldKey } from "../checkup/normalizers.js";
import { predicate } from "../offline/cohort.js";

function conditionPredicate(cond) {
  return predicate({ kind: "value", column: cond.column, value: cond.value, op: "=", negated: false });
}

// groups: [[{column,value}, ...], ...]. An empty array, or an array
// containing only empty groups, means "no filter" — every row matches, the
// same convention aggregate.js's applyFilter(rows, null) already uses.
function realGroups(groups) {
  return (groups || []).filter((g) => g && g.length > 0);
}

export function matchesFilterGroups(row, groups) {
  const real = realGroups(groups);
  if (real.length === 0) return true;
  return real.some((group) => group.every((cond) => conditionPredicate(cond)(row)));
}

export function applyFilterGroups(rows, groups) {
  const real = realGroups(groups);
  if (real.length === 0) return rows;
  return rows.filter((r) => matchesFilterGroups(r, groups));
}

// Matching-row count after filter groups, with no grouping/aggregation — the
// "N rows match" live-preview line. Deliberately built from applyFilterGroups
// alone, not buildDataset (which also does label grouping, bucketing, sort,
// noDataGroups bookkeeping — all wasted work for a plain count).
export function previewFilterCount(sheet, groups) {
  return applyFilterGroups(sheet.rows, groups).length;
}

// Per-group n once "Grouped by" has 1-2 columns set — a bare tally, not a
// full buildDataset/buildCrosstabDataset call (no value aggregation, no
// bucket, no Other-folding). A row missing any of the group columns is
// excluded, same as aggregate.js's own grouping loops skip blank labels.
export function previewGroupCounts(sheet, groups, groupCols) {
  const rows = applyFilterGroups(sheet.rows, groups);
  const tally = new Map(); // foldKey(joined) -> { label, n }
  for (const r of rows) {
    const parts = groupCols.map((c) => r[c]);
    if (parts.some((v) => v == null || String(v).trim() === "")) continue;
    const label = parts.map((v) => String(v)).join(" / ");
    const key = parts.map(foldKey).join("||");
    if (!tally.has(key)) tally.set(key, { label, n: 0 });
    tally.get(key).n += 1;
  }
  return [...tally.values()].sort((a, b) => b.n - a.n);
}
