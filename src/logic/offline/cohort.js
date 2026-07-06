// Run a confident match's resolved stages over the real rows (build prompt §8).
// Each stage is an AND filter applied on top of the one before it, so a nested
// "of those" question yields a count and a proportion at every level. In
// group-then-test mode the rows are first grouped by the entity column and a
// group qualifies for a stage if ANY of its rows meets that stage's condition —
// the per-patient answer, not the per-row one.

import { foldKey } from "../checkup/normalizers.js";
import { conditionPhrase } from "./matcher.js";

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
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
      entities = entities.filter((rowsOf) => rowsOf.some(pred));
      const count = entities.length;
      levels.push({
        description: conditionPhrase(stage.condition),
        count, denominator: prev, proportion: pct(count, prev), unit: `${match.grain.entity}s`,
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
    current = current.filter(pred);
    const count = current.length;
    levels.push({
      description: conditionPhrase(stage.condition),
      count, denominator: prev, proportion: pct(count, prev), unit: "rows",
    });
    prev = count;
  }
  return { unit: "rows", total, levels, mode: "row", matchedRows: current };
}
