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
    return (r) => r[cond.column] != null && foldKey(r[cond.column]) === want;
  }
  if (cond.kind === "set") {
    const set = new Set(cond.values.map(foldKey));
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
      entities = entities.filter((rowsOf) => rowsOf.some(pred));
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
