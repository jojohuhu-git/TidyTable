// Run a confident match's resolved stages over the real rows (build prompt §8).
// Each stage is an AND filter applied on top of the one before it, so a nested
// "of those" question yields a count and a proportion at every level. In
// group-then-test mode the rows are first grouped by the entity column and a
// group qualifies for a stage if ANY of its rows meets that stage's condition —
// the per-patient answer, not the per-row one.

import { foldKey } from "../checkup/normalizers.js";
import { conditionPhrase } from "./matcher.js";

// Self-contained (no closures) so fillPlan.js can inline this exact source via
// toString() into the worker transform — the two copies must never drift.
// Returns null (not 0) for anything that isn't a clean number: genuinely
// non-numeric text ("N/A", "pending"), a censored marker ("<5", ">100"), or a
// range ("12-14"). A trailing unit word ("5 Days") is stripped before the
// numeric check, so a legitimate unit-suffixed duration still counts.
export function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  var s = String(v).trim();
  if (s === "") return null;
  var unitMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*[A-Za-z]+\.?\s*$/);
  if (unitMatch) s = unitMatch[1];
  var cleaned = s.replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  var n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function compare(n, op, target) {
  switch (op) {
    case ">": return n > target;
    case ">=": return n >= target;
    case "<": return n < target;
    case "<=": return n <= target;
    case "<>": return n !== target;
    default: return n === target;
  }
}

// Build a row predicate for a resolved condition.
export function predicate(cond) {
  if (cond.kind === "value") {
    const want = foldKey(cond.value);
    if (cond.op === "<>") {
      // Bug 3 (negation): blank cells count as "not X" — the same rows
      // Excel's COUNTIFS("<>X") counts, so the formula steps stay honest.
      return (r) => r[cond.column] == null || foldKey(r[cond.column]) !== want;
    }
    return (r) => r[cond.column] != null && foldKey(r[cond.column]) === want;
  }
  if (cond.kind === "set") {
    const set = new Set(cond.values.map(foldKey));
    if (cond.op === "not-in") {
      return (r) => r[cond.column] == null || !set.has(foldKey(r[cond.column]));
    }
    return (r) => r[cond.column] != null && set.has(foldKey(r[cond.column]));
  }
  if (cond.kind === "threshold") {
    return (r) => {
      if (cond.when) {
        const wv = r[cond.when.column];
        if (wv == null || foldKey(wv) !== foldKey(cond.when.value)) return false;
      }
      const n = toNumber(r[cond.column]);
      if (n == null) return false;
      return compare(n, cond.op, cond.value);
    };
  }
  return () => false;
}

// Bug 3 (negation): the positive twin of a negated value/set condition, used
// by group-then-test grain — a patient "never got X" iff NO row matches X,
// which is NOT the same as "some row is not X" for patients with several rows.
// Negated thresholds keep their flipped op and stay on the some() path.
export function positiveCondition(cond) {
  if (!cond.negated) return null;
  if (cond.kind === "value") return { ...cond, op: "=", negated: false };
  if (cond.kind === "set") return { ...cond, op: "in", negated: false };
  return null;
}

const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);

// How many rows in the given population had no readable number for a
// threshold condition's column (honoring its "when" guard), so the summary
// can say plainly that they were not counted rather than silently treating
// them as 0.
function countUnreadable(cond, rows) {
  if (cond.kind !== "threshold") return 0;
  let n = 0;
  for (const r of rows) {
    if (cond.when) {
      const wv = r[cond.when.column];
      if (wv == null || foldKey(wv) !== foldKey(cond.when.value)) continue;
    }
    if (toNumber(r[cond.column]) == null) n++;
  }
  return n;
}

// match: a "confident" result from matchRequest. Returns per-stage counts plus a
// small result table describing each level.
export function executeCohort(match, workbook) {
  const sheet = workbook.sheets.find((s) => s.name === match.sheetName) || workbook.sheets[0];
  const rows = sheet.rows;
  const groupThenTest = match.grainMode === "group-then-test" && match.grain;

  const levels = [];
  if (groupThenTest) {
    const col = match.grain.entityColumn;
    const groups = new Map();
    for (const r of rows) {
      const v = r[col];
      if (v == null || String(v).trim() === "") continue;
      const k = foldKey(v);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    let entities = [...groups.values()];
    const total = entities.length;
    let prev = total;
    for (const stage of match.stages) {
      const pred = predicate(stage.condition);
      const skippedCount = countUnreadable(stage.condition, entities.flatMap((g) => g));
      const pos = positiveCondition(stage.condition);
      entities = pos
        ? entities.filter((rowsOf) => !rowsOf.some(predicate(pos)))
        : entities.filter((rowsOf) => rowsOf.some(pred));
      const count = entities.length;
      levels.push({
        description: conditionPhrase(stage.condition),
        count, denominator: prev, proportion: pct(count, prev), unit: `${match.grain.entity}s`,
        skippedCount, skippedColumn: skippedCount ? stage.condition.column : null,
      });
      prev = count;
    }
    return { unit: `${match.grain.entity}s`, total, levels, mode: "group-then-test" };
  }

  // A3 Level 2: "how many patients per diagnosis" — a plain count/share broken
  // down one row per group value, instead of (or on top of) any filter stages.
  if (match.groupColumn) {
    let filtered = rows;
    for (const stage of match.stages) filtered = filtered.filter(predicate(stage.condition));
    const total = filtered.length;
    const groups = new Map(); // folded value -> { label, count }
    for (const r of filtered) {
      const v = r[match.groupColumn];
      if (v == null || String(v).trim() === "") continue;
      const k = foldKey(v);
      const entry = groups.get(k) || { label: v, count: 0 };
      entry.count += 1;
      groups.set(k, entry);
    }
    const groupResults = [...groups.values()].map((g) => ({ ...g, proportion: pct(g.count, total) }));
    return { unit: "rows", total, groupColumn: match.groupColumn, groupResults, mode: "group-by" };
  }

  let current = rows;
  const total = rows.length;
  let prev = total;
  for (const stage of match.stages) {
    const pred = predicate(stage.condition);
    const skippedCount = countUnreadable(stage.condition, current);
    current = current.filter(pred);
    const count = current.length;
    levels.push({
      description: conditionPhrase(stage.condition),
      count, denominator: prev, proportion: pct(count, prev), unit: "rows",
      skippedCount, skippedColumn: skippedCount ? stage.condition.column : null,
    });
    prev = count;
  }
  return { unit: "rows", total, levels, mode: "row", matchedRows: current };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// Phase 2: the full descriptive-statistics bundle for one array of readable
// numbers — mean, sample standard deviation, median, quartiles/IQR, min, max,
// range. Quartiles use the same "linear interpolation between closest ranks"
// method Excel's QUARTILE.INC uses (equivalent to R's/numpy's default "type 7"
// quantile), so the app's number and the Excel step's number always agree —
// median is just quantile(0.5) under the same method, which also matches
// Excel's MEDIAN() for both even and odd counts. Standard deviation is the
// SAMPLE statistic (n-1 denominator, matching Excel's STDEV.S), chosen because
// almost every row in a real clinical file is a sample of a larger population,
// never the population itself.
// n === 0: every field comes back null — there is nothing to report, not a
// silent 0 (the Phase 1/aggregate.js "N/A group defaults to 0" bug this phase
// deliberately does not repeat). n === 1: mean/median/min/max/range are the
// single value; sd is null (a spread needs at least two points).
export function computeNumericStats(nums) {
  const n = nums.length;
  if (n === 0) {
    return { n: 0, mean: null, sd: null, median: null, q1: null, q3: null, iqr: null, min: null, max: null, range: null };
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  let sd = null;
  if (n >= 2) {
    const sq = sorted.reduce((a, x) => a + (x - mean) ** 2, 0);
    sd = Math.sqrt(sq / (n - 1));
  }
  const quantile = (p) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const frac = idx - lo;
    return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
  };
  const median = quantile(0.5);
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const min = sorted[0];
  const max = sorted[n - 1];
  return {
    n, mean: round2(mean), sd: sd == null ? null : round2(sd),
    median: round2(median), q1: round2(q1), q3: round2(q3), iqr: round2(q3 - q1),
    min, max, range: round2(max - min),
  };
}

// A3 Level 2 / Phase 2: compute one number (or, for "describe", the full
// stats bundle) per group (or one overall) for a sum, average, distinct-count,
// median, quartiles, standard-deviation, min, max, range, or describe
// aggregation. Any filter stages run first — same predicate() machinery as a
// plain count — then the aggregate is taken over the resolved target column,
// per group when a group-by column was resolved. A row that has no readable
// number in the target column is not counted as 0; it is tallied separately
// (`skipped`) so the summary can say plainly it was skipped — never silently
// averaged/summed as if it were zero.
export function aggregateOne(rowsIn, targetColumn, aggIntent) {
  if (aggIntent === "distinct") {
    const seen = new Set();
    for (const r of rowsIn) {
      const v = r[targetColumn];
      if (v == null || String(v).trim() === "") continue;
      seen.add(foldKey(v));
    }
    return { value: seen.size, skipped: 0, n: rowsIn.length };
  }
  const nums = [];
  let skipped = 0;
  for (const r of rowsIn) {
    const num = toNumber(r[targetColumn]);
    if (num == null) { skipped++; continue; }
    nums.push(num);
  }
  const stats = computeNumericStats(nums);
  // "sum" stays the exact running total (unrounded) — the original A3 Level 2
  // behavior, unchanged, so existing sum answers/tests keep their same number.
  const sum = nums.reduce((a, b) => a + b, 0);
  const VALUE_BY_INTENT = {
    sum, average: stats.mean, median: stats.median, stdev: stats.sd,
    min: stats.min, max: stats.max, range: stats.range,
  };
  const value = aggIntent in VALUE_BY_INTENT ? VALUE_BY_INTENT[aggIntent] : null;
  return {
    value, skipped, n: stats.n,
    mean: stats.mean, sd: stats.sd, median: stats.median,
    q1: stats.q1, q3: stats.q3, iqr: stats.iqr,
    min: stats.min, max: stats.max, range: stats.range,
  };
}

// match: a "confident" match with match.aggregation set (see matcher.js).
export function executeAggregation(match, workbook) {
  const sheet = workbook.sheets.find((s) => s.name === match.sheetName) || workbook.sheets[0];
  let rows = sheet.rows;
  for (const stage of match.stages) rows = rows.filter(predicate(stage.condition));

  const { targetColumn, groupColumn } = match.aggregation;
  const aggIntent = match.intent;

  if (groupColumn) {
    const groups = new Map(); // folded value -> { label, rows: [] }
    for (const r of rows) {
      const v = r[groupColumn];
      if (v == null || String(v).trim() === "") continue;
      const k = foldKey(v);
      if (!groups.has(k)) groups.set(k, { label: v, rows: [] });
      groups.get(k).rows.push(r);
    }
    const results = [...groups.values()].map((g) => ({
      label: g.label,
      rowCount: g.rows.length,
      ...aggregateOne(g.rows, targetColumn, aggIntent),
    }));
    return { mode: "group", groupColumn, targetColumn, aggIntent, total: rows.length, results };
  }

  const one = aggregateOne(rows, targetColumn, aggIntent);
  return { mode: "single", targetColumn, aggIntent, total: rows.length, ...one };
}
