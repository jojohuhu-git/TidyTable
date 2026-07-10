// Turn a confident cohort match into a PLAN_SCHEMA-shaped plan (build prompt §8,
// §12). Like buildFixPlan, the output carries engine:"offline" and every schema
// field, plus `looked_for` — the trust line the UI always shows so a wrong read
// is visible before anyone trusts the number. The transform recomputes the same
// counts so re-running on new data stays honest.

import { executeCohort, executeAggregation, toNumber } from "./cohort.js";
import { excelRowExtent, excelRowExtentNote } from "../workbook.js";

const RESULT_KEYS = { checked: "What was checked", matched: "Matched", out: "Out of", share: "Share" };
const AGG_LABEL = { sum: "Sum", average: "Average", distinct: "Distinct count" };
const AGG_FORMULA = { sum: "SUMIFS", average: "AVERAGEIFS" };

// P2-16: *, ?, ~ are wildcards in a COUNTIFS/SUMIFS/AVERAGEIFS criterion —
// a cell value that literally contains one of them would otherwise be
// wildcard-matched by Excel while the app matched it exactly. Escape with ~.
function escapeCriteria(value) {
  return String(value).replace(/[~*?]/g, "~$&");
}

// P1-9: prepend the sheet's real-extent honesty note to the first step,
// whenever the sheet isn't perfectly tidy (see excelRowExtent/workbook.js).
function withExtentNote(steps, extent) {
  if (!extent.needsNote || !steps.length) return steps;
  return [{ ...steps[0], instruction: `${excelRowExtentNote(extent)} ${steps[0].instruction}` }, ...steps.slice(1)];
}

function letterFor(sheet, colName) {
  const h = sheet.headers.find((x) => x.name === colName);
  return h ? h.letter : "A";
}

// A plain-English answer built from the executed levels.
function buildSummary(match, exec) {
  const lines = [match.lookedFor, ""];
  const unit = exec.unit;
  lines.push(`Starting from ${exec.total} ${unit} in "${match.sheetName}":`);
  for (const lvl of exec.levels) {
    lines.push(`- ${lvl.description}: ${lvl.count} of ${lvl.denominator} ${unit} (${lvl.proportion}%).`);
    if (lvl.skippedCount) {
      lines.push(`  (${lvl.skippedCount} row${lvl.skippedCount === 1 ? "" : "s"} had no readable number in "${lvl.skippedColumn}" and were not counted.)`);
    }
  }
  lines.push("");
  lines.push("This was answered on your computer, with no data sent anywhere. The Excel steps reproduce the same counts by hand.");
  return lines.join("\n");
}

// COUNTIFS-style Excel steps, one per nested level, combining every condition up
// to that level. Set ("one of") conditions can't be a single COUNTIFS, so those
// get an honest AutoFilter instruction instead of a misleading formula.
function buildExcelSteps(match, exec, sheet) {
  const extent = excelRowExtent(sheet);
  const lastRow = extent.lastRow;
  const range = (col) => `'${sheet.name}'!${letterFor(sheet, col)}2:${letterFor(sheet, col)}${lastRow}`;
  const crit = (op, value) => (op === "=" ? `"${escapeCriteria(value)}"` : `"${op}${escapeCriteria(value)}"`);

  const steps = [];
  const upto = [];
  let teachesAdded = false;
  match.stages.forEach((stage, i) => {
    upto.push(stage.condition);
    const hasSet = upto.some((c) => c.kind === "set");
    if (hasSet) {
      steps.push({
        title: `Level ${i + 1}: ${stage.condition.term}`,
        where: `Sheet "${sheet.name}"`,
        formula: "",
        instruction:
          `Turn on Data > Filter, then filter each column to the values that count for "${stage.condition.term}". ` +
          `The row count Excel shows at the bottom is the matched number. A single COUNTIFS cannot list several accepted values, so filtering is the honest way here.`,
      });
      return;
    }
    const pairs = [];
    for (const c of upto) {
      pairs.push(`${range(c.column)}, ${crit(c.op, c.value)}`);
      if (c.when) pairs.push(`${range(c.when.column)}, "${escapeCriteria(c.when.value)}"`);
    }
    const step = {
      title: `Level ${i + 1}: ${stage.condition.term}`,
      where: "An empty cell",
      formula: `=COUNTIFS(${pairs.join(", ")})`,
      instruction: `Counts the ${exec.unit} that meet every condition up to this level. It should equal ${exec.levels[i].count}.`,
    };
    if (!teachesAdded) {
      step.teaches = "COUNTIFS counts rows that meet several conditions at once — each pair is a column to look in and what to look for.";
      teachesAdded = true;
    }
    steps.push(step);
  });
  return withExtentNote(steps, extent);
}

// The transform body the worker can re-run: it rebuilds the same counts table
// from `sheets`, so the downloadable result matches what the app showed.
function buildTransformCode(match) {
  const stages = match.stages.map((s) => s.condition);
  const grain = match.grainMode === "group-then-test" && match.grain
    ? { entityColumn: match.grain.entityColumn }
    : null;
  return `
var foldKey = function (v) { return String(v).trim().toLowerCase().replace(/\\s+/g, " "); };
${toNumber.toString()}
var cmp = function (n, op, t) { switch (op) { case ">": return n > t; case ">=": return n >= t; case "<": return n < t; case "<=": return n <= t; case "<>": return n !== t; default: return n === t; } };
var STAGES = ${JSON.stringify(stages)};
var GRAIN = ${JSON.stringify(grain)};
var SHEET = ${JSON.stringify(match.sheetName)};
var UNIT = ${JSON.stringify(grain ? "people" : "rows")};
var rows = sheets[SHEET] || [];
var pred = function (c) { return function (r) {
  if (c.kind === "value") { if (c.op === "<>") { return r[c.column] == null || foldKey(r[c.column]) !== foldKey(c.value); } return r[c.column] != null && foldKey(r[c.column]) === foldKey(c.value); }
  if (c.kind === "set") { var set = {}; for (var i = 0; i < c.values.length; i++) { set[foldKey(c.values[i])] = 1; } if (c.op === "not-in") { return r[c.column] == null || set[foldKey(r[c.column])] !== 1; } return r[c.column] != null && set[foldKey(r[c.column])] === 1; }
  if (c.kind === "threshold") { if (c.when) { var wv = r[c.when.column]; if (wv == null || foldKey(wv) !== foldKey(c.when.value)) return false; } var n = toNumber(r[c.column]); if (n == null) return false; return cmp(n, c.op, c.value); }
  return false;
}; };
var out = [];
if (GRAIN) {
  var groups = {}; var order = [];
  for (var i = 0; i < rows.length; i++) { var v = rows[i][GRAIN.entityColumn]; if (v == null || String(v).trim() === "") continue; var k = foldKey(v); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(rows[i]); }
  var ents = order.map(function (k) { return groups[k]; });
  var prev = ents.length;
  var posOf = function (c) { if (!c.negated) return null; if (c.kind === "value") { var v = JSON.parse(JSON.stringify(c)); v.op = "="; v.negated = false; return v; } if (c.kind === "set") { var t = JSON.parse(JSON.stringify(c)); t.op = "in"; t.negated = false; return t; } return null; };
  for (var s = 0; s < STAGES.length; s++) { var pos = posOf(STAGES[s]); var p = pos ? pred(pos) : pred(STAGES[s]); ents = ents.filter(function (g) { return pos ? !g.some(p) : g.some(p); }); var row = {}; row[${JSON.stringify(RESULT_KEYS.checked)}] = STAGES[s].term; row[${JSON.stringify(RESULT_KEYS.matched)}] = ents.length; row[${JSON.stringify(RESULT_KEYS.out)}] = prev; row[${JSON.stringify(RESULT_KEYS.share)}] = (prev ? Math.round(ents.length / prev * 1000) / 10 : 0) + "%"; out.push(row); prev = ents.length; }
} else {
  var cur = rows; var prevR = rows.length;
  for (var s2 = 0; s2 < STAGES.length; s2++) { var p2 = pred(STAGES[s2]); cur = cur.filter(p2); var row2 = {}; row2[${JSON.stringify(RESULT_KEYS.checked)}] = STAGES[s2].term; row2[${JSON.stringify(RESULT_KEYS.matched)}] = cur.length; row2[${JSON.stringify(RESULT_KEYS.out)}] = prevR; row2[${JSON.stringify(RESULT_KEYS.share)}] = (prevR ? Math.round(cur.length / prevR * 1000) / 10 : 0) + "%"; out.push(row2); prevR = cur.length; }
}
return out;
`.trim();
}

// A3 Level 2: "how many patients per diagnosis" — a plain count broken down
// one row per group value, instead of a single running total.
function buildGroupCountSummary(match, exec) {
  const lines = [match.lookedFor, ""];
  const filteredNote = match.stages.length ? " that matched the conditions above" : "";
  lines.push(`Starting from ${exec.total} rows in "${match.sheetName}"${filteredNote}, broken down by "${exec.groupColumn}":`);
  const sorted = [...exec.groupResults].sort((a, b) => b.count - a.count);
  for (const g of sorted) {
    lines.push(`- ${g.label}: ${g.count} of ${exec.total} rows (${g.proportion}%).`);
  }
  lines.push("");
  lines.push("This was answered on your computer, with no data sent anywhere. The Excel steps reproduce the same counts by hand.");
  return lines.join("\n");
}

function buildGroupCountExcelSteps(match, exec, sheet) {
  const extent = excelRowExtent(sheet);
  const lastRow = extent.lastRow;
  const range = (col) => `'${sheet.name}'!${letterFor(sheet, col)}2:${letterFor(sheet, col)}${lastRow}`;
  const crit = (op, value) => (op === "=" ? `"${escapeCriteria(value)}"` : `"${op}${escapeCriteria(value)}"`);
  const hasSet = match.stages.some((s) => s.condition.kind === "set");

  if (hasSet) {
    return withExtentNote([{
      title: `Breakdown by "${exec.groupColumn}"`,
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction:
        `Turn on Data > Filter and filter each column to the values that count for the conditions above. Then build a ` +
        `PivotTable with "${exec.groupColumn}" in Rows and Count of any column in Values to see the breakdown per group. ` +
        `A single COUNTIFS cannot list several accepted values, so filtering first is the honest way here.`,
    }], extent);
  }

  const filterPairs = [];
  for (const stage of match.stages) {
    const c = stage.condition;
    filterPairs.push(`${range(c.column)}, ${crit(c.op, c.value)}`);
    if (c.when) filterPairs.push(`${range(c.when.column)}, "${escapeCriteria(c.when.value)}"`);
  }
  const steps = exec.groupResults.map((g, i) => {
    const pairs = [`${range(exec.groupColumn)}, ${crit("=", g.label)}`, ...filterPairs];
    const step = {
      title: `${g.label}`,
      where: "An empty cell",
      formula: `=COUNTIFS(${pairs.join(", ")})`,
      instruction: `Counts the rows where "${exec.groupColumn}" is ${g.label}${filterPairs.length ? " and every other condition above" : ""}. It should equal ${g.count}.`,
    };
    if (i === 0) step.teaches = "COUNTIFS counts rows that meet several conditions at once — each pair is a column to look in and what to look for.";
    return step;
  });
  return withExtentNote(steps, extent);
}

function buildGroupCountTransformCode(match) {
  const stages = match.stages.map((s) => s.condition);
  return `
var foldKey = function (v) { return String(v).trim().toLowerCase().replace(/\\s+/g, " "); };
${toNumber.toString()}
var cmp = function (n, op, t) { switch (op) { case ">": return n > t; case ">=": return n >= t; case "<": return n < t; case "<=": return n <= t; case "<>": return n !== t; default: return n === t; } };
var STAGES = ${JSON.stringify(stages)};
var GROUP = ${JSON.stringify(match.groupColumn)};
var SHEET = ${JSON.stringify(match.sheetName)};
var rows = sheets[SHEET] || [];
var pred = function (c) { return function (r) {
  if (c.kind === "value") { if (c.op === "<>") { return r[c.column] == null || foldKey(r[c.column]) !== foldKey(c.value); } return r[c.column] != null && foldKey(r[c.column]) === foldKey(c.value); }
  if (c.kind === "set") { var set = {}; for (var i = 0; i < c.values.length; i++) { set[foldKey(c.values[i])] = 1; } if (c.op === "not-in") { return r[c.column] == null || set[foldKey(r[c.column])] !== 1; } return r[c.column] != null && set[foldKey(r[c.column])] === 1; }
  if (c.kind === "threshold") { if (c.when) { var wv = r[c.when.column]; if (wv == null || foldKey(wv) !== foldKey(c.when.value)) return false; } var n = toNumber(r[c.column]); if (n == null) return false; return cmp(n, c.op, c.value); }
  return false;
}; };
var filtered = rows;
for (var s = 0; s < STAGES.length; s++) { filtered = filtered.filter(pred(STAGES[s])); }
var groups = {}; var order = [];
for (var i2 = 0; i2 < filtered.length; i2++) {
  var v = filtered[i2][GROUP];
  if (v == null || String(v).trim() === "") continue;
  var k = foldKey(v);
  if (!groups[k]) { groups[k] = { label: v, count: 0 }; order.push(k); }
  groups[k].count++;
}
var total = filtered.length;
var out = order.map(function (k) {
  var g = groups[k];
  var row = {};
  row[GROUP] = g.label;
  row["Count"] = g.count;
  row["Share of total"] = (total ? Math.round(g.count / total * 1000) / 10 : 0) + "%";
  return row;
});
return out;
`.trim();
}

function fillGroupCountPlan(match, workbook, sheet) {
  const exec = executeCohort(match, workbook);
  const sorted = [...exec.groupResults].sort((a, b) => b.count - a.count);
  const resultRows = sorted.map((g) => ({
    [exec.groupColumn]: g.label,
    Count: g.count,
    "Share of total": `${g.proportion}%`,
  }));

  const plan = {
    engine: "offline",
    looked_for: match.lookedFor,
    summary: buildGroupCountSummary(match, exec),
    transform_code: buildGroupCountTransformCode(match),
    excel_steps: buildGroupCountExcelSteps(match, exec, sheet),
    r_script:
      "# This breakdown was worked out inside TidyTable, on your computer.\n" +
      "# The result table and the Excel steps above reproduce it exactly.\n" +
      "# A full R version of group breakdowns arrives with the statistics features.\n",
    r_run_notes:
      "This breakdown ran on your computer, so there is no R script to run for it yet. " +
      "Use the Excel steps to reproduce the same numbers by hand.",
  };
  return { plan, resultRows, exec };
}

// A3 Level 2: sum/average/distinct over a resolved numeric (or, for
// "distinct", any) column, optionally broken down per group. Filters run
// first, same as a plain count.
function buildAggregationSummary(match, exec, label) {
  const lines = [match.lookedFor, ""];
  if (exec.mode === "group") {
    lines.push(`Starting from ${exec.total} rows in "${match.sheetName}", broken down by "${exec.groupColumn}":`);
    const sorted = [...exec.results].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    for (const g of sorted) {
      const val = g.value == null ? "no readable numbers" : g.value;
      lines.push(`- ${g.label}: ${label.toLowerCase()} ${val} (from ${g.n} of ${g.rowCount} rows).`);
      if (g.skipped) lines.push(`  (${g.skipped} row${g.skipped === 1 ? "" : "s"} had no readable number in "${exec.targetColumn}" and were not counted.)`);
    }
  } else {
    const val = exec.value == null ? "no rows had a readable number" : exec.value;
    lines.push(`${label} of "${exec.targetColumn}" across ${exec.total} row${exec.total === 1 ? "" : "s"} in "${match.sheetName}": ${val}.`);
    if (exec.skipped) lines.push(`(${exec.skipped} row${exec.skipped === 1 ? "" : "s"} had no readable number in "${exec.targetColumn}" and were not counted.)`);
  }
  lines.push("");
  lines.push("This was answered on your computer, with no data sent anywhere. The Excel steps reproduce the same result by hand.");
  return lines.join("\n");
}

function buildAggregationExcelSteps(match, exec, sheet, label) {
  const extent = excelRowExtent(sheet);
  const lastRow = extent.lastRow;
  const range = (col) => `'${sheet.name}'!${letterFor(sheet, col)}2:${letterFor(sheet, col)}${lastRow}`;
  const crit = (op, value) => (op === "=" ? `"${escapeCriteria(value)}"` : `"${op}${escapeCriteria(value)}"`);
  const filterPairs = [];
  for (const stage of match.stages) {
    const c = stage.condition;
    if (c.kind === "set") continue;
    filterPairs.push(`${range(c.column)}, ${crit(c.op, c.value)}`);
    if (c.when) filterPairs.push(`${range(c.when.column)}, "${escapeCriteria(c.when.value)}"`);
  }
  const hasSet = match.stages.some((s) => s.condition.kind === "set");
  const targetRange = range(exec.targetColumn);
  const formulaName = AGG_FORMULA[exec.aggIntent];

  if (exec.aggIntent === "distinct" || hasSet) {
    const groupNote = exec.mode === "group" ? ` for each value of "${exec.groupColumn}"` : "";
    return withExtentNote([{
      title: label,
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction:
        (hasSet
          ? "A single formula can't check several accepted values at once, so filter first: turn on Data > Filter and filter to the conditions above. "
          : "") +
        `Then, to get a distinct count${groupNote}, copy the "${exec.targetColumn}" column for the filtered rows to a new area, ` +
        "use Data > Remove Duplicates, and the remaining row count is the distinct count. It should equal " +
        (exec.mode === "group" ? "the numbers in the result table." : `${exec.value}.`),
    }], extent);
  }

  if (exec.mode === "group") {
    const steps = exec.results.map((g, i) => {
      const pairs = [`${range(exec.groupColumn)}, ${crit("=", g.label)}`, ...filterPairs];
      const step = {
        title: `${g.label}`,
        where: "An empty cell",
        formula: `=${formulaName}(${targetRange}, ${pairs.join(", ")})`,
        instruction: `${label} of "${exec.targetColumn}" where "${exec.groupColumn}" is ${g.label}${filterPairs.length ? " and every other condition above" : ""}. It should equal ${g.value}.`,
      };
      if (i === 0) {
        step.teaches = exec.aggIntent === "sum"
          ? "SUMIFS adds up a numeric column, only counting rows that meet the given conditions."
          : "AVERAGEIFS computes the mean of a numeric column, only over rows that meet the given conditions.";
      }
      return step;
    });
    return withExtentNote(steps, extent);
  }

  return withExtentNote([{
    title: label,
    where: "An empty cell",
    formula: filterPairs.length
      ? `=${formulaName}(${targetRange}, ${filterPairs.join(", ")})`
      : `=${exec.aggIntent === "sum" ? "SUM" : "AVERAGE"}(${targetRange})`,
    instruction: `${label} of "${exec.targetColumn}"${filterPairs.length ? " across the rows that meet the conditions above" : ""}. It should equal ${exec.value}.`,
    teaches: exec.aggIntent === "sum"
      ? "SUMIFS/SUM add up a numeric column, optionally only counting rows that meet given conditions."
      : "AVERAGEIFS/AVERAGE compute the mean of a numeric column, optionally only over rows that meet given conditions.",
  }], extent);
}

function buildAggregationTransformCode(match, label) {
  const stages = match.stages.map((s) => s.condition);
  const { targetColumn, groupColumn } = match.aggregation;
  return `
var foldKey = function (v) { return String(v).trim().toLowerCase().replace(/\\s+/g, " "); };
${toNumber.toString()}
var cmp = function (n, op, t) { switch (op) { case ">": return n > t; case ">=": return n >= t; case "<": return n < t; case "<=": return n <= t; case "<>": return n !== t; default: return n === t; } };
var STAGES = ${JSON.stringify(stages)};
var TARGET = ${JSON.stringify(targetColumn)};
var GROUP = ${JSON.stringify(groupColumn)};
var AGG = ${JSON.stringify(match.intent)};
var LABEL = ${JSON.stringify(label)};
var SHEET = ${JSON.stringify(match.sheetName)};
var rows = sheets[SHEET] || [];
var pred = function (c) { return function (r) {
  if (c.kind === "value") { if (c.op === "<>") { return r[c.column] == null || foldKey(r[c.column]) !== foldKey(c.value); } return r[c.column] != null && foldKey(r[c.column]) === foldKey(c.value); }
  if (c.kind === "set") { var set = {}; for (var i = 0; i < c.values.length; i++) { set[foldKey(c.values[i])] = 1; } if (c.op === "not-in") { return r[c.column] == null || set[foldKey(r[c.column])] !== 1; } return r[c.column] != null && set[foldKey(r[c.column])] === 1; }
  if (c.kind === "threshold") { if (c.when) { var wv = r[c.when.column]; if (wv == null || foldKey(wv) !== foldKey(c.when.value)) return false; } var n = toNumber(r[c.column]); if (n == null) return false; return cmp(n, c.op, c.value); }
  return false;
}; };
var filtered = rows;
for (var s = 0; s < STAGES.length; s++) { filtered = filtered.filter(pred(STAGES[s])); }
var aggOne = function (rs) {
  if (AGG === "distinct") {
    var seen = {}; var cnt = 0;
    for (var i2 = 0; i2 < rs.length; i2++) { var v2 = rs[i2][TARGET]; if (v2 == null || String(v2).trim() === "") continue; var k2 = foldKey(v2); if (!seen[k2]) { seen[k2] = 1; cnt++; } }
    return { value: cnt, n: rs.length, skipped: 0 };
  }
  var sum = 0, n = 0, skipped = 0;
  for (var i3 = 0; i3 < rs.length; i3++) { var num = toNumber(rs[i3][TARGET]); if (num == null) { skipped++; continue; } sum += num; n++; }
  var value = AGG === "sum" ? sum : (n ? Math.round(sum / n * 100) / 100 : null);
  return { value: value, n: n, skipped: skipped };
};
var out = [];
if (GROUP) {
  var groups = {}; var order = [];
  for (var j = 0; j < filtered.length; j++) { var gv = filtered[j][GROUP]; if (gv == null || String(gv).trim() === "") continue; var gk = foldKey(gv); if (!groups[gk]) { groups[gk] = { label: gv, rows: [] }; order.push(gk); } groups[gk].rows.push(filtered[j]); }
  out = order.map(function (gk) {
    var g = groups[gk]; var res = aggOne(g.rows); var row = {};
    row[GROUP] = g.label; row[LABEL] = res.value; row["Rows used"] = res.n; if (res.skipped) row["Rows skipped"] = res.skipped;
    return row;
  });
} else {
  var res2 = aggOne(filtered);
  var row2 = {}; row2[LABEL] = res2.value; row2["Rows used"] = res2.n; if (res2.skipped) row2["Rows skipped"] = res2.skipped;
  out = [row2];
}
return out;
`.trim();
}

function fillAggregationPlan(match, workbook, sheet) {
  const exec = executeAggregation(match, workbook);
  const label = AGG_LABEL[exec.aggIntent] || "Value";

  const resultRows = exec.mode === "group"
    ? [...exec.results].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)).map((g) => ({
        [exec.groupColumn]: g.label,
        [label]: g.value,
        "Rows used": g.n,
        ...(g.skipped ? { "Rows skipped (no readable number)": g.skipped } : {}),
      }))
    : [{
        [label]: exec.value,
        "Rows used": exec.n,
        ...(exec.skipped ? { "Rows skipped (no readable number)": exec.skipped } : {}),
      }];

  const plan = {
    engine: "offline",
    looked_for: match.lookedFor,
    summary: buildAggregationSummary(match, exec, label),
    transform_code: buildAggregationTransformCode(match, label),
    excel_steps: buildAggregationExcelSteps(match, exec, sheet, label),
    r_script:
      "# This result was worked out inside TidyTable, on your computer.\n" +
      "# The result table and the Excel steps above reproduce it exactly.\n" +
      "# A full R version arrives with the statistics features.\n",
    r_run_notes:
      "This ran on your computer, so there is no R script to run for it yet. " +
      "Use the Excel steps to reproduce the same numbers by hand.",
  };
  return { plan, resultRows, exec };
}

// W3: a plain one-line answer for a confident match's execution — used for the
// "results so far" cards (e.g. "14 patients", "5 groups", "312.5") and, on
// replay, to build the plain-report line for an auto-recorded question step.
// Never a guess: it just reads the same `exec` shape fillPlan already builds.
export function summarizeAnswer(match, exec) {
  if (match.aggregation) {
    if (exec.mode === "group") {
      return `${exec.results.length} group${exec.results.length === 1 ? "" : "s"}`;
    }
    return exec.value == null ? "no readable numbers" : String(exec.value);
  }
  if (exec.mode === "group-by") {
    return `${exec.total} rows across ${exec.groupResults.length} group${exec.groupResults.length === 1 ? "" : "s"}`;
  }
  const last = exec.levels[exec.levels.length - 1];
  return last ? `${last.count} ${exec.unit}` : `${exec.total} ${exec.unit}`;
}

// Public: build the plan and the ready-to-show result rows for a confident match.
export function fillPlan(match, workbook) {
  const sheet = workbook.sheets.find((s) => s.name === match.sheetName) || workbook.sheets[0];

  if (match.aggregation) return fillAggregationPlan(match, workbook, sheet);
  if (match.groupColumn) return fillGroupCountPlan(match, workbook, sheet);

  const exec = executeCohort(match, workbook);
  const resultRows = exec.levels.map((lvl) => ({
    [RESULT_KEYS.checked]: lvl.description,
    [RESULT_KEYS.matched]: lvl.count,
    [RESULT_KEYS.out]: lvl.denominator,
    [RESULT_KEYS.share]: `${lvl.proportion}%`,
  }));

  const plan = {
    engine: "offline",
    looked_for: match.lookedFor,
    summary: buildSummary(match, exec),
    transform_code: buildTransformCode(match),
    excel_steps: buildExcelSteps(match, exec, sheet),
    r_script:
      "# This count was worked out inside TidyTable, on your computer.\n" +
      "# The result table and the Excel steps above reproduce it exactly.\n" +
      "# A full R version of cohort counts arrives with the statistics features.\n",
    r_run_notes:
      "This count ran on your computer, so there is no R script to run for it yet. " +
      "Use the Excel steps to reproduce the same numbers by hand.",
  };
  return { plan, resultRows, exec };
}
