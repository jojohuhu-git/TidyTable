// Turn a confident cohort match into a PLAN_SCHEMA-shaped plan (build prompt §8,
// §12). Like buildFixPlan, the output carries engine:"offline" and every schema
// field, plus `looked_for` — the trust line the UI always shows so a wrong read
// is visible before anyone trusts the number. The transform recomputes the same
// counts so re-running on new data stays honest.

import {
  executeCohort, executeAggregation, executeTopN, toNumber, topNWithTies,
} from "./cohort.js";
import { excelRowExtent, excelRowExtentNote } from "../workbook.js";
import { describeLookedForAggregation } from "./matcher.js";
import { formatMeanSD, formatMedianIQR, formatNPercent } from "./clinicalFormat.js";
import { formatDurationLabel, inferColumnUnit } from "./units.js";
import { executeTable1, table1ResultRows, buildTable1Summary, table1ColumnMeta, numericSummaryText } from "./table1.js";

const RESULT_KEYS = { checked: "What was checked", matched: "Matched", out: "Out of", share: "Share" };
// Phase 2 (2026-07-10): descriptive-statistics labels alongside the original
// sum/average/distinct.
const AGG_LABEL = {
  sum: "Sum", average: "Average", distinct: "Distinct count",
  median: "Median", quartiles: "Quartiles", stdev: "Standard deviation",
  min: "Minimum", max: "Maximum", range: "Range",
};
// Native Excel "...IFS" formulas that can filter and aggregate in one step.
const IFS_FORMULA = { sum: "SUMIFS", average: "AVERAGEIFS", min: "MINIFS", max: "MAXIFS" };
const DIRECT_FORMULA = { sum: "SUM", average: "AVERAGE", min: "MIN", max: "MAX" };
// Phase 2: stats with NO native "...IFS" Excel function — MEDIANIFS,
// STDEVIFS, and a QUARTILEIFS simply don't exist. Unfiltered, a single
// sheet-wide formula still works directly; once a condition applies, the
// honest fallback is the same "filter first, then compute" pattern already
// used for a distinct count or a Definitions "set" condition.
const NO_IFS_HINT = {
  median: "MEDIAN", stdev: "STDEV.S (sample standard deviation)",
  range: "MAX and MIN (range = MAX minus MIN)", quartiles: "QUARTILE.INC and MEDIAN",
};
// Deterministic "anticipate & suggest" companions (no AI): asked for a mean,
// offer the median (better for skewed data); asked for a median, offer the
// mean. Both directions reuse the exact same fillAggregationPlan code path on
// the swapped intent, so the companion number is guaranteed consistent with
// what that same question would answer directly.
const COMPANION_OF = { average: "median", median: "average" };
const COMPANION_LABEL = {
  average: "median (IQR) instead — better for skewed or outlier-heavy data",
  median: "mean (SD) instead — the standard summary for roughly symmetric data",
};

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
    // Phase 7.6: denominator transparency — blanks in the filter column sit in
    // the denominator but can never match, so the % is out of ALL of them.
    if (lvl.blankInColumn) {
      lines.push(`  (${lvl.blankInColumn} of those ${lvl.denominator} ${unit} were blank in "${lvl.blankColumn}", so the ${lvl.proportion}% is out of all ${lvl.denominator} — the blanks are in the denominator but can never match.)`);
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

// Phase 2: the primary answer text for one aggregate result (either the
// overall `exec` or one group's result — both carry the same full stats
// bundle from cohort.js's aggregateOne), in clinical reporting format.
// mean/median also get their companion spread stat (SD / IQR) folded into the
// same string, per the plan's "the ask carries the format" rule. The headline
// value is passed through units.js's unit-aware labeling — the clinical style
// "10 days (IQR 7–14)": unit named once on the headline, parenthetical spread
// numbers in the same (already-named) unit. `distinct` is exempt (its value
// is a count of distinct values, not a duration-shaped number).
function statDisplay(aggIntent, g, targetColumn) {
  const label = (v) => formatDurationLabel(v, targetColumn);
  if (aggIntent === "distinct") {
    return { text: String(g.value), assumptionNote: null };
  }
  if (aggIntent === "average") {
    if (g.mean == null) return { text: "no readable numbers", assumptionNote: null };
    const meanLbl = label(g.mean);
    if (g.sd == null) return { text: `${meanLbl.text} (SD not available — fewer than 2 readable numbers)`, assumptionNote: meanLbl.assumptionNote };
    return { text: `${meanLbl.text} (SD ${g.sd})`, assumptionNote: meanLbl.assumptionNote };
  }
  if (aggIntent === "median") {
    if (g.median == null) return { text: "no readable numbers", assumptionNote: null };
    const medLbl = label(g.median);
    if (g.q1 == null || g.q3 == null) return { text: `${medLbl.text} (IQR not available — fewer than 2 readable numbers)`, assumptionNote: medLbl.assumptionNote };
    return { text: `${medLbl.text} (IQR ${g.q1}–${g.q3})`, assumptionNote: medLbl.assumptionNote };
  }
  if (aggIntent === "quartiles") {
    if (g.q1 == null || g.q3 == null) return { text: "no readable numbers", assumptionNote: null };
    const medLbl = label(g.median);
    return {
      text: `Q1 ${g.q1}, median ${medLbl.text}, Q3 ${g.q3} (IQR ${g.iqr})`,
      assumptionNote: medLbl.assumptionNote,
    };
  }
  if (aggIntent === "range") {
    if (g.value == null) return { text: "no readable numbers", assumptionNote: null };
    const rangeLbl = label(g.value);
    return { text: `${rangeLbl.text} (from ${g.min} to ${g.max})`, assumptionNote: rangeLbl.assumptionNote };
  }
  if (g.value == null) return { text: "no readable numbers", assumptionNote: null };
  return label(g.value);
}

// A group-mode sort key: by the primary value normally, or by the median for
// quartiles (which has no single `.value`).
function statSortKey(aggIntent, g) {
  if (aggIntent === "quartiles") return g.median ?? -Infinity;
  return g.value ?? -Infinity;
}

// A3 Level 2 / Phase 2: sum/average/distinct/median/quartiles/stdev/min/max/
// range over a resolved numeric (or, for "distinct", any) column, optionally
// broken down per group. Filters run first, same as a plain count. Clinical
// formatting (mean (SD), median (IQR)) and unit-aware duration labeling are
// applied by statDisplay above; any "I won't guess the unit" assumption is
// stated once, in the answer line, never silently picked.
function buildAggregationSummary(match, exec, label) {
  const lines = [match.lookedFor, ""];
  const notes = new Set();
  if (exec.mode === "group") {
    lines.push(`Starting from ${exec.total} rows in "${match.sheetName}", broken down by "${exec.groupColumn}":`);
    const sorted = [...exec.results].sort((a, b) => statSortKey(exec.aggIntent, b) - statSortKey(exec.aggIntent, a));
    for (const g of sorted) {
      const disp = statDisplay(exec.aggIntent, g, exec.targetColumn);
      if (disp.assumptionNote) notes.add(disp.assumptionNote);
      lines.push(`- ${g.label}: ${label.toLowerCase()} ${disp.text} (from ${g.n} of ${g.rowCount} rows).`);
      if (g.skipped) lines.push(`  (${g.skipped} row${g.skipped === 1 ? "" : "s"} had no readable number in "${exec.targetColumn}" and were not counted.)`);
    }
  } else {
    const disp = statDisplay(exec.aggIntent, exec, exec.targetColumn);
    if (disp.assumptionNote) notes.add(disp.assumptionNote);
    lines.push(`${label} of "${exec.targetColumn}" across ${exec.total} row${exec.total === 1 ? "" : "s"} in "${match.sheetName}": ${disp.text}.`);
    if (exec.skipped) lines.push(`(${exec.skipped} row${exec.skipped === 1 ? "" : "s"} had no readable number in "${exec.targetColumn}" and were not counted.)`);
  }
  for (const note of notes) lines.push(note);
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

  // Distinct count: always the copy + Remove Duplicates pattern.
  if (exec.aggIntent === "distinct") {
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

  // A Definitions "set" ("one of A, B, C") condition can't be a single ...IFS
  // criterion for ANY stat — filter first, honestly, then run the plain
  // (non-IFS) formula over the filtered rows. Generalizes the same fallback
  // the distinct-count branch above already used, to whichever stat was asked
  // for (this used to say "to get a distinct count" even for an average with
  // a Definitions set condition — fixed here as part of the Phase 2 rewrite).
  if (hasSet) {
    const hint = NO_IFS_HINT[exec.aggIntent] || `${DIRECT_FORMULA[exec.aggIntent]}`;
    const groupNote = exec.mode === "group" ? ` for each value of "${exec.groupColumn}"` : "";
    return withExtentNote([{
      title: label,
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction:
        "A single formula can't check several accepted values at once, so filter first: turn on Data > Filter and filter to the conditions above. " +
        `Then copy the "${exec.targetColumn}" column for the filtered rows to a new area${groupNote} and run ${hint} there. It should equal ` +
        (exec.mode === "group" || exec.aggIntent === "quartiles" ? "the numbers in the result table." : `${exec.value}.`),
    }], extent);
  }

  // Phase 2: stats with no native "...IFS" Excel function.
  if (exec.aggIntent in NO_IFS_HINT) {
    const hint = NO_IFS_HINT[exec.aggIntent];
    if (exec.mode !== "group" && filterPairs.length === 0) {
      // No conditions at all — a direct, sheet-wide formula (or formulas).
      if (exec.aggIntent === "quartiles") {
        return withExtentNote([
          {
            title: "Q1 (25th percentile)", where: "An empty cell", formula: `=QUARTILE.INC(${targetRange}, 1)`,
            instruction: `It should equal ${exec.q1}.`,
            teaches: "QUARTILE.INC finds a percentile using the same rank-interpolation method TidyTable uses, so the numbers always agree.",
          },
          { title: "Median (50th percentile)", where: "An empty cell", formula: `=MEDIAN(${targetRange})`, instruction: `It should equal ${exec.median}.` },
          { title: "Q3 (75th percentile)", where: "An empty cell", formula: `=QUARTILE.INC(${targetRange}, 3)`, instruction: `It should equal ${exec.q3}. IQR = Q3 minus Q1 = ${exec.iqr}.` },
        ], extent);
      }
      const formula = exec.aggIntent === "range" ? `=MAX(${targetRange})-MIN(${targetRange})` : `=${hint.split(" ")[0]}(${targetRange})`;
      const value = exec.aggIntent === "range" ? exec.range : exec.aggIntent === "median" ? exec.median : exec.sd;
      return withExtentNote([{
        title: label,
        where: "An empty cell",
        formula,
        instruction: `${label} of "${exec.targetColumn}". It should equal ${value}.`,
        teaches: `${hint} — Excel has no "...IFS" version of this statistic, so it always runs on a whole range; filter the sheet first if you need it on a subset.`,
      }], extent);
    }
    // Filtered and/or grouped, with no Definitions set: the same honest
    // filter-first-then-compute fallback.
    const groupNote = exec.mode === "group" ? ` for each value of "${exec.groupColumn}"` : "";
    return withExtentNote([{
      title: label,
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction:
        `Excel has no "...IFS" version of ${hint}, so filter first: turn on Data > Filter and filter to the conditions above${exec.mode === "group" ? " (one group value at a time, plus the breakdown column)" : ""}. ` +
        `Then copy the "${exec.targetColumn}" column for the filtered rows to a new area${groupNote} and run ${hint} there. It should equal ` +
        (exec.mode === "group" || exec.aggIntent === "quartiles" ? "the numbers in the result table." : `${exec.value}.`),
    }], extent);
  }

  // sum/average/min/max: a native "...IFS" formula.
  const formulaName = IFS_FORMULA[exec.aggIntent];
  const directName = DIRECT_FORMULA[exec.aggIntent];
  if (exec.mode === "group") {
    const steps = exec.results.map((g, i) => {
      const pairs = [`${range(exec.groupColumn)}, ${crit("=", g.label)}`, ...filterPairs];
      const step = {
        title: `${g.label}`,
        where: "An empty cell",
        formula: `=${formulaName}(${targetRange}, ${pairs.join(", ")})`,
        instruction: `${label} of "${exec.targetColumn}" where "${exec.groupColumn}" is ${g.label}${filterPairs.length ? " and every other condition above" : ""}. It should equal ${g.value}.`,
      };
      if (i === 0) step.teaches = `${formulaName} computes the ${label.toLowerCase()} of a numeric column, only over rows that meet the given conditions.`;
      return step;
    });
    return withExtentNote(steps, extent);
  }

  return withExtentNote([{
    title: label,
    where: "An empty cell",
    formula: filterPairs.length
      ? `=${formulaName}(${targetRange}, ${filterPairs.join(", ")})`
      : `=${directName}(${targetRange})`,
    instruction: `${label} of "${exec.targetColumn}"${filterPairs.length ? " across the rows that meet the conditions above" : ""}. It should equal ${exec.value}.`,
    teaches: `${formulaName}/${directName} compute the ${label.toLowerCase()} of a numeric column, optionally only over rows that meet given conditions.`,
  }], extent);
}

// Phase 2: the ES5, self-contained (no closures beyond its own params) stats
// block the worker transform inlines — median/quartiles/stdev/min/max/range,
// matching cohort.js's computeNumericStats exactly (same rank-interpolation
// quantile method, same sample-SD n-1 denominator, same round-to-2-decimals),
// so a replayed transform reproduces the exact number the app already showed.
const STATS_BLOCK = `
var round2 = function (x) { return x == null ? null : Math.round(x * 100) / 100; };
var computeStats = function (nums) {
  var n = nums.length;
  if (n === 0) return { n: 0, mean: null, sd: null, median: null, q1: null, q3: null, iqr: null, min: null, max: null, range: null };
  var sorted = nums.slice().sort(function (a, b) { return a - b; });
  var sum = 0; for (var i = 0; i < n; i++) sum += sorted[i];
  var mean = sum / n;
  var sd = null;
  if (n >= 2) { var sq = 0; for (var j = 0; j < n; j++) { var d = sorted[j] - mean; sq += d * d; } sd = Math.sqrt(sq / (n - 1)); }
  var quantile = function (p) {
    var idx = (n - 1) * p; var lo = Math.floor(idx); var hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    var frac = idx - lo; return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
  };
  var median = quantile(0.5), q1 = quantile(0.25), q3 = quantile(0.75);
  return {
    n: n, mean: round2(mean), sd: sd == null ? null : round2(sd),
    median: round2(median), q1: round2(q1), q3: round2(q3), iqr: round2(q3 - q1),
    min: sorted[0], max: sorted[n - 1], range: round2(sorted[n - 1] - sorted[0]),
  };
};
`;

function buildAggregationTransformCode(match, label) {
  const stages = match.stages.map((s) => s.condition);
  const { targetColumn, groupColumn } = match.aggregation;
  return `
var foldKey = function (v) { return String(v).trim().toLowerCase().replace(/\\s+/g, " "); };
${toNumber.toString()}
${STATS_BLOCK}
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
  var nums = [];
  for (var i3 = 0; i3 < rs.length; i3++) { var num = toNumber(rs[i3][TARGET]); if (num != null) nums.push(num); }
  var skipped = rs.length - nums.length;
  var stats = computeStats(nums);
  var sum = 0; for (var i4 = 0; i4 < nums.length; i4++) sum += nums[i4];
  var VALUE = { sum: sum, average: stats.mean, median: stats.median, stdev: stats.sd, min: stats.min, max: stats.max, range: stats.range };
  var value = (AGG in VALUE) ? VALUE[AGG] : null;
  return {
    value: value, n: stats.n, skipped: skipped,
    mean: stats.mean, sd: stats.sd, median: stats.median, q1: stats.q1, q3: stats.q3, iqr: stats.iqr,
    min: stats.min, max: stats.max, range: stats.range,
  };
};
var rowFor = function (res, extra) {
  var row = {};
  for (var k in extra) row[k] = extra[k];
  if (AGG === "quartiles") { row["Q1"] = res.q1; row["Median"] = res.median; row["Q3"] = res.q3; row["IQR"] = res.iqr; }
  else { row[LABEL] = res.value; }
  row["Rows used"] = res.n;
  if (res.skipped) row["Rows skipped"] = res.skipped;
  return row;
};
var out = [];
if (GROUP) {
  var groups = {}; var order = [];
  for (var j = 0; j < filtered.length; j++) { var gv = filtered[j][GROUP]; if (gv == null || String(gv).trim() === "") continue; var gk = foldKey(gv); if (!groups[gk]) { groups[gk] = { label: gv, rows: [] }; order.push(gk); } groups[gk].rows.push(filtered[j]); }
  out = order.map(function (gk) {
    var g = groups[gk]; var res = aggOne(g.rows); var extra = {}; extra[GROUP] = g.label;
    return rowFor(res, extra);
  });
} else {
  var res2 = aggOne(filtered);
  out = [rowFor(res2, {})];
}
return out;
`.trim();
}

// Phase 2: one result row for a stat, from either the overall `exec` or one
// group's result. Quartiles has no single value — it gets its own Q1/Median/
// Q3/IQR columns; every other stat keeps the original single [label] column.
function statResultRow(aggIntent, label, g, extra = {}) {
  if (aggIntent === "quartiles") {
    return {
      ...extra, Q1: g.q1, Median: g.median, Q3: g.q3, IQR: g.iqr,
      "Rows used": g.n, ...(g.skipped ? { "Rows skipped (no readable number)": g.skipped } : {}),
    };
  }
  return {
    ...extra, [label]: g.value, "Rows used": g.n,
    ...(g.skipped ? { "Rows skipped (no readable number)": g.skipped } : {}),
  };
}

function fillAggregationPlan(match, workbook, sheet, opts = {}) {
  const exec = executeAggregation(match, workbook);
  const label = AGG_LABEL[exec.aggIntent] || "Value";

  const resultRows = exec.mode === "group"
    ? [...exec.results]
      .sort((a, b) => statSortKey(exec.aggIntent, b) - statSortKey(exec.aggIntent, a))
      .map((g) => statResultRow(exec.aggIntent, label, g, { [exec.groupColumn]: g.label }))
    : [statResultRow(exec.aggIntent, label, exec)];

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

  // Phase 2 "anticipate & suggest": offer the standard companion stat as a
  // one-click chip. `opts.skipCompanion` stops the companion's own
  // fillAggregationPlan call from recursively building a companion for ITS
  // companion (average -> median -> average -> ...).
  if (!opts.skipCompanion) {
    const companion = buildCompanion(match, workbook, sheet);
    if (companion) plan.companion = companion;
  }

  return { plan, resultRows, exec };
}

// Deterministic, no AI: average <-> median. Reuses fillAggregationPlan on the
// swapped intent, so the companion's number is guaranteed to be exactly what
// asking that question directly would produce — never a separately-computed
// approximation. The whole altMatch rides along so App.jsx can record the
// companion into the routine as a normal, replayable question step.
function buildCompanion(match, workbook, sheet) {
  const altIntent = COMPANION_OF[match.intent];
  if (!altIntent || !match.aggregation) return null;
  const altMatch = {
    ...match,
    intent: altIntent,
    lookedFor: describeLookedForAggregation(
      altIntent,
      match.aggregation.targetColumn,
      match.stages,
      match.aggregation.groupColumn ? { column: match.aggregation.groupColumn } : null,
    ),
  };
  const { plan: altPlan, resultRows: altResultRows, exec: altExec } = fillAggregationPlan(altMatch, workbook, sheet, { skipCompanion: true });
  return {
    kind: "swap-stat",
    label: COMPANION_LABEL[match.intent],
    intent: altIntent,
    plan: altPlan,
    resultRows: altResultRows,
    match: altMatch,
    answer: summarizeAnswer(altMatch, altExec),
  };
}

// W3: a plain one-line answer for a confident match's execution — used for the
// "results so far" cards (e.g. "14 patients", "5 groups", "312.5") and, on
// replay, to build the plain-report line for an auto-recorded question step.
// Never a guess: it just reads the same `exec` shape fillPlan already builds.
export function summarizeAnswer(match, exec) {
  if (match.table1) {
    return `Table 1: ${exec.columns.length} characteristic${exec.columns.length === 1 ? "" : "s"}`;
  }
  if (match.intent === "describe") {
    return exec.n === 0 ? "no readable numbers" : `n=${exec.n}, mean ${exec.mean}, median ${exec.median}`;
  }
  if (match.topN) {
    if (!exec.ranked.length) return "no data";
    const top = exec.ranked[0];
    return exec.family === "frequency" ? `${top.label} (${top.count})` : String(top.value);
  }
  if (match.aggregation) {
    if (exec.mode === "group") {
      return `${exec.results.length} group${exec.results.length === 1 ? "" : "s"}`;
    }
    if (match.intent === "quartiles") {
      return exec.q1 == null ? "no readable numbers" : `Q1 ${exec.q1}, median ${exec.median}, Q3 ${exec.q3}`;
    }
    return exec.value == null ? "no readable numbers" : String(exec.value);
  }
  if (exec.mode === "group-by") {
    return `${exec.total} rows across ${exec.groupResults.length} group${exec.groupResults.length === 1 ? "" : "s"}`;
  }
  const last = exec.levels[exec.levels.length - 1];
  return last ? `${last.count} ${exec.unit}` : `${exec.total} ${exec.unit}`;
}

// Phase 2 ("describe/summarize X"): one descriptive-statistics panel — n,
// missing, mean (SD), median (IQR), min–max — optionally broken down per
// group. Reuses the exact same executeAggregation/aggregateOne path every
// other stat uses (aggregateOne always computes the full stats bundle
// regardless of which single value an intent asks for), so a describe panel's
// numbers are guaranteed consistent with asking for each stat individually.
// "3–10 days": range in the clinical style, unit named once at the end (only
// when the column name states it — units.js never guesses one).
function minMaxText(g, targetColumn) {
  if (!g.n) return { text: "no readable numbers", assumptionNote: null };
  const maxLbl = formatDurationLabel(g.max, targetColumn);
  return { text: `${g.min}–${maxLbl.text}`, assumptionNote: maxLbl.assumptionNote };
}

function describeRow(g, targetColumn, extra = {}) {
  return {
    ...extra,
    n: g.n,
    Missing: g.skipped,
    "Mean (SD)": formatMeanSD(g.mean, g.sd),
    "Median (IQR)": formatMedianIQR(g.median, g.q1, g.q3),
    "Min–Max": minMaxText(g, targetColumn).text,
  };
}

function buildDescribeSummary(match, exec) {
  const lines = [match.lookedFor, ""];
  const notes = new Set();
  const describeLines = (g, prefix) => {
    const minMax = minMaxText(g, exec.targetColumn);
    if (minMax.assumptionNote) notes.add(minMax.assumptionNote);
    lines.push(`${prefix}n = ${g.n}, missing = ${g.skipped}.`);
    lines.push(`${prefix}Mean (SD): ${formatMeanSD(g.mean, g.sd)}. Median (IQR, the "typical range"): ${formatMedianIQR(g.median, g.q1, g.q3)}. Min–Max: ${minMax.text}.`);
  };
  if (exec.mode === "group") {
    lines.push(`Describing "${exec.targetColumn}" in "${match.sheetName}", broken down by "${exec.groupColumn}":`);
    const sorted = [...exec.results].sort((a, b) => b.n - a.n);
    for (const g of sorted) {
      lines.push("");
      lines.push(`${g.label}:`);
      describeLines(g, "  ");
    }
  } else {
    lines.push(`Describing "${exec.targetColumn}" across ${exec.total} row${exec.total === 1 ? "" : "s"} in "${match.sheetName}":`);
    describeLines(exec, "");
  }
  for (const note of notes) lines.push(note);
  lines.push("");
  lines.push("This was answered on your computer, with no data sent anywhere. The Excel steps reproduce the same numbers by hand.");
  return lines.join("\n");
}

function buildDescribeExcelSteps(match, exec, sheet) {
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
  const isFiltered = filterPairs.length > 0 || hasSet || exec.mode === "group";

  if (isFiltered) {
    const groupNote = exec.mode === "group" ? ` for each value of "${exec.groupColumn}"` : "";
    return withExtentNote([{
      title: "Descriptive statistics",
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction:
        `Turn on Data > Filter and filter to the conditions above${exec.mode === "group" ? " (one group value at a time, plus the breakdown column)" : ""}. ` +
        `Then copy the "${exec.targetColumn}" column for the filtered rows to a new area${groupNote}, and run COUNT (n), AVERAGE, STDEV.S, MEDIAN, QUARTILE.INC (1 and 3), MIN and MAX on it. ` +
        "It should equal the numbers in the result table.",
      teaches: "COUNT, AVERAGE, STDEV.S, MEDIAN, QUARTILE.INC, MIN and MAX together give n, the mean, the spread, the median, the typical range, and the extremes for a column.",
    }], extent);
  }

  return withExtentNote([
    { title: "n (readable numbers)", where: "An empty cell", formula: `=COUNT(${targetRange})`, instruction: `It should equal ${exec.n}.` },
    {
      title: "Missing / unreadable",
      where: "An empty cell",
      formula: `=ROWS(${targetRange})-COUNT(${targetRange})`,
      instruction: `Rows in the range minus rows COUNT could read as a number — blank cells and unreadable text ("N/A", etc.) both count. It should equal ${exec.skipped}.`,
    },
    { title: "Mean", where: "An empty cell", formula: `=AVERAGE(${targetRange})`, instruction: `It should equal ${exec.mean}.` },
    {
      title: "Standard deviation",
      where: "An empty cell",
      formula: `=STDEV.S(${targetRange})`,
      instruction: `It should equal ${exec.sd ?? "not available — fewer than 2 readable numbers"}.`,
      teaches: "STDEV.S is the SAMPLE standard deviation (n-1 denominator) — the usual choice when your rows are a sample, not the whole population.",
    },
    { title: "Median", where: "An empty cell", formula: `=MEDIAN(${targetRange})`, instruction: `It should equal ${exec.median}.` },
    {
      title: "Q1 and Q3 (for the IQR)",
      where: "An empty cell",
      formula: `=QUARTILE.INC(${targetRange}, 1)`,
      instruction: `Q1. For Q3, use =QUARTILE.INC(range, 3). Q1 should equal ${exec.q1}, Q3 should equal ${exec.q3} (IQR = ${exec.iqr}).`,
    },
    {
      title: "Min and Max",
      where: "An empty cell",
      formula: `=MIN(${targetRange})`,
      instruction: `Minimum. For the maximum, use =MAX(range). Min should equal ${exec.min}, Max should equal ${exec.max}.`,
    },
  ], extent);
}

function buildDescribeTransformCode(match) {
  const stages = match.stages.map((s) => s.condition);
  const { targetColumn, groupColumn } = match.aggregation;
  // The unit suffix is decided HERE, at plan-build time, from the column name
  // (units.js inferColumnUnit — never guessed) and inlined as a constant, so
  // the replayed transform's "Min–Max" text is byte-for-byte what the app's
  // result table showed.
  const columnUnit = inferColumnUnit(targetColumn);
  const unit = columnUnit ? ` ${columnUnit}` : "";
  return `
var foldKey = function (v) { return String(v).trim().toLowerCase().replace(/\\s+/g, " "); };
${toNumber.toString()}
${STATS_BLOCK}
${formatMeanSD.toString()}
${formatMedianIQR.toString()}
var UNIT_SUFFIX = ${JSON.stringify(unit)};
var cmp = function (n, op, t) { switch (op) { case ">": return n > t; case ">=": return n >= t; case "<": return n < t; case "<=": return n <= t; case "<>": return n !== t; default: return n === t; } };
var STAGES = ${JSON.stringify(stages)};
var TARGET = ${JSON.stringify(targetColumn)};
var GROUP = ${JSON.stringify(groupColumn)};
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
var describeOne = function (rs) {
  var nums = [];
  for (var i2 = 0; i2 < rs.length; i2++) { var num = toNumber(rs[i2][TARGET]); if (num != null) nums.push(num); }
  var skipped = rs.length - nums.length;
  var stats = computeStats(nums);
  return {
    n: stats.n, missing: skipped,
    meanSd: formatMeanSD(stats.mean, stats.sd),
    medianIqr: formatMedianIQR(stats.median, stats.q1, stats.q3),
    minMax: stats.n ? (stats.min + "–" + stats.max + UNIT_SUFFIX) : "no readable numbers",
  };
};
var out = [];
if (GROUP) {
  var groups = {}; var order = [];
  for (var j = 0; j < filtered.length; j++) { var gv = filtered[j][GROUP]; if (gv == null || String(gv).trim() === "") continue; var gk = foldKey(gv); if (!groups[gk]) { groups[gk] = { label: gv, rows: [] }; order.push(gk); } groups[gk].rows.push(filtered[j]); }
  out = order.map(function (gk) {
    var g = groups[gk]; var res = describeOne(g.rows); var row = {};
    row[GROUP] = g.label; row["n"] = res.n; row["Missing"] = res.missing;
    row["Mean (SD)"] = res.meanSd; row["Median (IQR)"] = res.medianIqr; row["Min–Max"] = res.minMax;
    return row;
  });
} else {
  var res2 = describeOne(filtered);
  out = [{ n: res2.n, Missing: res2.missing, "Mean (SD)": res2.meanSd, "Median (IQR)": res2.medianIqr, "Min–Max": res2.minMax }];
}
return out;
`.trim();
}

function fillDescribePlan(match, workbook, sheet) {
  const exec = executeAggregation(match, workbook);

  const resultRows = exec.mode === "group"
    ? [...exec.results].sort((a, b) => b.n - a.n).map((g) => describeRow(g, exec.targetColumn, { [exec.groupColumn]: g.label }))
    : [describeRow(exec, exec.targetColumn)];

  const plan = {
    engine: "offline",
    looked_for: match.lookedFor,
    summary: buildDescribeSummary(match, exec),
    transform_code: buildDescribeTransformCode(match),
    excel_steps: buildDescribeExcelSteps(match, exec, sheet),
    r_script:
      "# This descriptive panel was worked out inside TidyTable, on your computer.\n" +
      "# The result table and the Excel steps above reproduce it exactly.\n" +
      "# A full R version (e.g. summary()/psych::describe()) arrives with the statistics features.\n",
    r_run_notes:
      "This ran on your computer, so there is no R script to run for it yet. " +
      "Use the Excel steps to reproduce the same numbers by hand.",
  };
  return { plan, resultRows, exec };
}

// Phase 4 (2026-07-10): most-common/top-N ranking — two output shapes, per
// column type (see matcher.js's matchTopN / DEFAULT_TOPN):
//  - "frequency" (any column type): how often each value appears, most/least
//    common first, each row "value — n (%)". Percentages are of the rows
//    with a READABLE value in the target column (blank/unreadable cells are
//    excluded from the ranking itself, never surfaced as a winner) — the
//    denominator is stated whenever it differs from the row total.
//  - "magnitude" (numeric column only): the raw rows ranked by that column's
//    value, largest/smallest first. The full matched row is returned (every
//    column), like an Excel "sort, then look at the top rows" would show.
// Either way, a tie sitting at the N-th cutoff is shown in full rather than
// arbitrarily split — stated in the summary whenever it makes the shown
// count differ from what was asked for.

function buildTopNFrequencySummary(match, exec) {
  const lines = [match.lookedFor, ""];
  const denom = exec.total - exec.blank;
  const dirWord = exec.direction === "least" ? "least common first" : "most common first";
  const denomNote = exec.blank ? ` (${denom} with a readable "${exec.targetColumn}")` : "";
  lines.push(`Starting from ${exec.total} row${exec.total === 1 ? "" : "s"} in "${match.sheetName}"${denomNote}, ranking "${exec.targetColumn}" by how often each value appears (${dirWord}):`);
  for (const e of exec.ranked) {
    lines.push(`- ${e.label}: ${formatNPercent(e.count, denom)}.`);
  }
  if (exec.blank) {
    lines.push(`(${exec.blank} row${exec.blank === 1 ? "" : "s"} had a blank or unreadable "${exec.targetColumn}" — excluded from the ranking and from the ${denom} used as the percentage base.)`);
  }
  if (exec.ranked.length < exec.distinctValues) {
    const extended = exec.ranked.length > exec.n ? "; extended to include a tie at the cutoff" : "";
    lines.push(`Showing ${exec.ranked.length} of ${exec.distinctValues} distinct values (asked for top ${exec.n}${extended}).`);
  } else if (exec.ranked.length > exec.n) {
    lines.push(`Asked for the top ${exec.n}; showing all ${exec.ranked.length} because of a tie at the cutoff.`);
  }
  lines.push("");
  lines.push("This was answered on your computer, with no data sent anywhere. The Excel steps reproduce the same counts by hand.");
  return lines.join("\n");
}

function buildTopNMagnitudeSummary(match, exec, sheet) {
  const lines = [match.lookedFor, ""];
  const notes = new Set();
  const dirWord = exec.direction === "least" ? "smallest first" : "largest first";
  lines.push(`Starting from ${exec.total} row${exec.total === 1 ? "" : "s"} in "${match.sheetName}", ranking "${exec.targetColumn}" by value (${dirWord}):`);
  const idCol = sheet.headers[0] ? sheet.headers[0].name : null;
  exec.ranked.forEach((e, i) => {
    const lbl = formatDurationLabel(e.value, exec.targetColumn);
    if (lbl.assumptionNote) notes.add(lbl.assumptionNote);
    const raw = idCol ? e.row[idCol] : null;
    const idNote = idCol ? ` (${idCol}: ${raw == null || String(raw).trim() === "" ? "blank" : raw})` : "";
    lines.push(`${i + 1}. ${lbl.text}${idNote}.`);
  });
  if (exec.unreadable) {
    lines.push(`(${exec.unreadable} row${exec.unreadable === 1 ? "" : "s"} had no readable number in "${exec.targetColumn}" and were excluded from the ranking.)`);
  }
  if (exec.ranked.length > exec.n) {
    lines.push(`Asked for the top ${exec.n}; showing ${exec.ranked.length} because of a tie at the cutoff.`);
  }
  for (const note of notes) lines.push(note);
  lines.push("");
  lines.push("This was answered on your computer, with no data sent anywhere. The Excel steps reproduce the same values by hand.");
  return lines.join("\n");
}

// Excel has no single "top N most common" formula. Reuse the group-count
// breakdown's COUNTIFS-per-value pattern (same honest fallback for a
// Definitions "set" filter) but only for the values actually ranked, plus an
// upfront note about sorting/PivotTable — the same "honest multi-step
// instruction, not a fake formula" precedent Phase 2 set for MEDIANIFS etc.
function buildTopNFrequencyExcelSteps(match, exec, sheet) {
  const extent = excelRowExtent(sheet);
  const lastRow = extent.lastRow;
  const range = (col) => `'${sheet.name}'!${letterFor(sheet, col)}2:${letterFor(sheet, col)}${lastRow}`;
  const crit = (op, value) => (op === "=" ? `"${escapeCriteria(value)}"` : `"${op}${escapeCriteria(value)}"`);
  const hasSet = match.stages.some((s) => s.condition.kind === "set");

  const intro = {
    title: `Rank "${exec.targetColumn}" by frequency`,
    where: `Sheet "${sheet.name}"`,
    formula: "",
    instruction:
      "Excel has no single \"top N most common\" formula. Build a PivotTable with " +
      `"${exec.targetColumn}" in Rows and Count of any column in Values, then use the pivot's own sort button ` +
      `to sort ${exec.direction === "least" ? "smallest to largest" : "largest to smallest"} — the top rows are the ranking. ` +
      "The COUNTIFS formulas below confirm each value's count by hand" +
      (hasSet ? ", once you've filtered to the conditions above (a single formula can't check several accepted values at once)" : "") + ".",
  };

  if (hasSet) {
    return withExtentNote([intro, {
      title: "Filter first",
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction: "Turn on Data > Filter and filter each column to the values that count for the conditions above, then build the PivotTable on the filtered rows.",
    }], extent);
  }

  const filterPairs = [];
  for (const stage of match.stages) {
    const c = stage.condition;
    filterPairs.push(`${range(c.column)}, ${crit(c.op, c.value)}`);
    if (c.when) filterPairs.push(`${range(c.when.column)}, "${escapeCriteria(c.when.value)}"`);
  }
  const steps = exec.ranked.map((e, i) => {
    const pairs = [`${range(exec.targetColumn)}, ${crit("=", e.label)}`, ...filterPairs];
    const step = {
      title: `${e.label}`,
      where: "An empty cell",
      formula: `=COUNTIFS(${pairs.join(", ")})`,
      instruction: `Counts the rows where "${exec.targetColumn}" is ${e.label}${filterPairs.length ? " and every other condition above" : ""}. It should equal ${e.count}.`,
    };
    if (i === 0) step.teaches = "COUNTIFS counts rows that meet several conditions at once; sorting these counts by hand (or via a PivotTable) gives the ranking.";
    return step;
  });
  return withExtentNote([intro, ...steps], extent);
}

// Magnitude ranking IS a native Excel operation — Data > Sort — plus LARGE/
// SMALL as a one-cell spot-check of the top value, so this gets a real
// formula where the frequency family cannot.
function buildTopNMagnitudeExcelSteps(match, exec, sheet) {
  const extent = excelRowExtent(sheet);
  const lastRow = extent.lastRow;
  const targetRange = `'${sheet.name}'!${letterFor(sheet, exec.targetColumn)}2:${letterFor(sheet, exec.targetColumn)}${lastRow}`;
  const hasFilters = match.stages.length > 0;
  const fn = exec.direction === "least" ? "SMALL" : "LARGE";
  const steps = [{
    title: `Sort by "${exec.targetColumn}"`,
    where: `Sheet "${sheet.name}"`,
    formula: "",
    instruction:
      (hasFilters ? "Turn on Data > Filter and filter to the conditions above first. Then t" : "T") +
      `urn on Data > Sort, sort by "${exec.targetColumn}" ${exec.direction === "least" ? "smallest to largest" : "largest to smallest"}. ` +
      `The top ${exec.n} row${exec.n === 1 ? "" : "s"} shown are the ranking (a tie at the cutoff may show as more than ${exec.n} rows, which is honest — they are genuinely tied).`,
  }];
  if (!hasFilters) {
    steps.push({
      title: `Check the ${exec.direction === "least" ? "smallest" : "largest"} value`,
      where: "An empty cell",
      formula: `=${fn}(${targetRange}, 1)`,
      instruction: `Confirms the ${exec.direction === "least" ? "smallest" : "largest"} value directly. It should equal ${exec.ranked.length ? exec.ranked[0].value : "n/a"}.`,
      teaches: `${fn} returns the k-th ${exec.direction === "least" ? "smallest" : "largest"} value in a range — a quick check independent of sorting.`,
    });
  }
  return withExtentNote(steps, extent);
}

// cohort.js's rankFrequency/rankMagnitude call the module-level `foldKey`/
// `toNumber` IMPORTS — reusing their real .toString() here would carry a
// broken reference into the transform (Vite rewrites imports at the source
// level, so a toString()'d function that calls one no longer resolves once
// pasted elsewhere; verified this breaks under the exact "execute the
// generated code" test this file's own tests use). So, like STATS_BLOCK
// above, these two are hand-mirrored literal text — kept in sync with
// cohort.js deliberately, never toString()'d. topNWithTies has no such
// reference and IS toString()'d directly below (same trick as toNumber).
const RANK_FREQUENCY_BLOCK = `
var rankFrequency = function (rows, column) {
  var groups = {}; var order = []; var blank = 0;
  for (var i = 0; i < rows.length; i++) {
    var v = rows[i][column];
    if (v == null || String(v).trim() === "") { blank++; continue; }
    var k = foldKey(v);
    if (!groups[k]) { groups[k] = { label: v, count: 0 }; order.push(k); }
    groups[k].count++;
  }
  var entries = [];
  for (var j = 0; j < order.length; j++) entries.push(groups[order[j]]);
  return { entries: entries, blank: blank, total: rows.length };
};
`;
const RANK_MAGNITUDE_BLOCK = `
var rankMagnitude = function (rows, column) {
  var entries = []; var unreadable = 0;
  for (var i = 0; i < rows.length; i++) {
    var n = toNumber(rows[i][column]);
    if (n == null) { unreadable++; continue; }
    entries.push({ row: rows[i], value: n });
  }
  return { entries: entries, unreadable: unreadable, total: rows.length };
};
`;

function buildTopNFrequencyTransformCode(match, exec) {
  const stages = match.stages.map((s) => s.condition);
  return `
var foldKey = function (v) { return String(v).trim().toLowerCase().replace(/\\s+/g, " "); };
${toNumber.toString()}
${RANK_FREQUENCY_BLOCK}
${topNWithTies.toString()}
var cmp = function (n, op, t) { switch (op) { case ">": return n > t; case ">=": return n >= t; case "<": return n < t; case "<=": return n <= t; case "<>": return n !== t; default: return n === t; } };
var STAGES = ${JSON.stringify(stages)};
var TARGET = ${JSON.stringify(exec.targetColumn)};
var N = ${exec.n === Infinity ? "Infinity" : JSON.stringify(exec.n)};
var DIRECTION = ${JSON.stringify(exec.direction)};
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
var freq = rankFrequency(filtered, TARGET);
var ranked = topNWithTies(freq.entries, N, function (e) { return e.count; }, DIRECTION);
var denom = freq.total - freq.blank;
var out = ranked.map(function (e) {
  var row = {};
  row[TARGET] = e.label;
  row["Count"] = e.count;
  row["Share of total"] = (denom ? Math.round(e.count / denom * 1000) / 10 : 0) + "%";
  return row;
});
return out;
`.trim();
}

function buildTopNMagnitudeTransformCode(match, exec) {
  const stages = match.stages.map((s) => s.condition);
  return `
var foldKey = function (v) { return String(v).trim().toLowerCase().replace(/\\s+/g, " "); };
${toNumber.toString()}
${RANK_MAGNITUDE_BLOCK}
${topNWithTies.toString()}
var cmp = function (n, op, t) { switch (op) { case ">": return n > t; case ">=": return n >= t; case "<": return n < t; case "<=": return n <= t; case "<>": return n !== t; default: return n === t; } };
var STAGES = ${JSON.stringify(stages)};
var TARGET = ${JSON.stringify(exec.targetColumn)};
var N = ${exec.n === Infinity ? "Infinity" : JSON.stringify(exec.n)};
var DIRECTION = ${JSON.stringify(exec.direction)};
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
var mag = rankMagnitude(filtered, TARGET);
var ranked = topNWithTies(mag.entries, N, function (e) { return e.value; }, DIRECTION);
var out = ranked.map(function (e, i) {
  var row = { Rank: i + 1 };
  for (var k in e.row) row[k] = e.row[k];
  return row;
});
return out;
`.trim();
}

function fillTopNPlan(match, workbook, sheet) {
  const exec = executeTopN(match, workbook);
  const isFrequency = exec.family === "frequency";

  const resultRows = isFrequency
    ? exec.ranked.map((e) => {
      const denom = exec.total - exec.blank;
      return {
        [exec.targetColumn]: e.label,
        Count: e.count,
        "Share of total": `${denom ? Math.round((e.count / denom) * 1000) / 10 : 0}%`,
      };
    })
    : exec.ranked.map((e, i) => ({ Rank: i + 1, ...e.row }));

  const plan = {
    engine: "offline",
    looked_for: match.lookedFor,
    summary: isFrequency ? buildTopNFrequencySummary(match, exec) : buildTopNMagnitudeSummary(match, exec, sheet),
    transform_code: isFrequency ? buildTopNFrequencyTransformCode(match, exec) : buildTopNMagnitudeTransformCode(match, exec),
    excel_steps: isFrequency ? buildTopNFrequencyExcelSteps(match, exec, sheet) : buildTopNMagnitudeExcelSteps(match, exec, sheet),
    r_script:
      "# This ranking was worked out inside TidyTable, on your computer.\n" +
      "# The result table and the Excel steps above reproduce it exactly.\n" +
      "# A full R version arrives with the statistics features.\n",
    r_run_notes:
      "This ranking ran on your computer, so there is no R script to run for it yet. " +
      "Use the Excel steps to reproduce the same result by hand.",
  };
  return { plan, resultRows, exec };
}

// Phase 7.5: the Table-1 builder — a publication-style descriptive table over
// several named columns at once. Categorical columns as n (%) per level,
// numeric columns as median (IQR) with mean (SD), missing counts per column.
// The worker transform rebuilds the same table by inlining the exact same
// numeric-summary and n(%) formatters (toString()'d, like STATS_BLOCK), so a
// replayed table is byte-for-byte what the app showed.
function buildTable1TransformCode(match, sheet) {
  const cols = table1ColumnMeta(match, sheet);
  return `
var foldKey = function (v) { return String(v).trim().toLowerCase().replace(/\\s+/g, " "); };
${toNumber.toString()}
${STATS_BLOCK}
${numericSummaryText.toString()}
${formatNPercent.toString()}
var COLS = ${JSON.stringify(cols)};
var SHEET = ${JSON.stringify(match.sheetName)};
var rows = sheets[SHEET] || [];
var TOTAL = rows.length;
var out = [];
for (var ci = 0; ci < COLS.length; ci++) {
  var col = COLS[ci];
  if (col.numeric) {
    var nums = []; var missing = 0;
    for (var i = 0; i < rows.length; i++) { var n = toNumber(rows[i][col.name]); if (n == null) { missing++; continue; } nums.push(n); }
    var st = computeStats(nums);
    var row = {}; row["Characteristic"] = col.name; row["Summary"] = numericSummaryText(st, col.unit); row["Missing"] = missing;
    out.push(row);
  } else {
    var groups = {}; var order = []; var blank = 0;
    for (var j = 0; j < rows.length; j++) { var v = rows[j][col.name]; if (v == null || String(v).trim() === "") { blank++; continue; } var k = foldKey(v); if (!groups[k]) { groups[k] = { label: v, count: 0 }; order.push(k); } groups[k].count++; }
    var entries = []; for (var o = 0; o < order.length; o++) entries.push(groups[order[o]]);
    entries.sort(function (a, b) { return b.count - a.count; });
    var denom = TOTAL - blank;
    var hdr = {}; hdr["Characteristic"] = col.name + " — n (%)"; hdr["Summary"] = ""; hdr["Missing"] = blank; out.push(hdr);
    for (var e = 0; e < entries.length; e++) { var lr = {}; lr["Characteristic"] = "  " + entries[e].label; lr["Summary"] = formatNPercent(entries[e].count, denom); lr["Missing"] = ""; out.push(lr); }
  }
}
return out;
`.trim();
}

function buildTable1ExcelSteps(match, exec, sheet) {
  const extent = excelRowExtent(sheet);
  const cols = table1ColumnMeta(match, sheet);
  const catCols = cols.filter((c) => !c.numeric).map((c) => `"${c.name}"`).join(", ");
  const numCols = cols.filter((c) => c.numeric).map((c) => `"${c.name}"`).join(", ");
  const steps = [];
  if (catCols) {
    steps.push({
      title: "Categorical columns — n (%)",
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction:
        `For each of ${catCols}, build a PivotTable with the column in Rows and Count of any column in Values to get n per level, ` +
        "then divide each by the number of rows that have a value in that column (blank/unreadable cells excluded) for the percentage. It should match the result table.",
      teaches: "A PivotTable count per category value, over its non-blank denominator, is the n (%) a paper's Table 1 reports.",
    });
  }
  if (numCols) {
    steps.push({
      title: "Numeric columns — median (IQR) and mean (SD)",
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction:
        `For each of ${numCols}, run MEDIAN, QUARTILE.INC(range,1) and QUARTILE.INC(range,3) for the median and IQR, and AVERAGE and STDEV.S for the mean and SD. ` +
        "COUNT gives n; rows minus COUNT gives the missing count. It should match the result table.",
      teaches: "Median (IQR) is the robust summary for skewed data; mean (SD) is the symmetric-data summary — a Table 1 usually shows the median (IQR).",
    });
  }
  return withExtentNote(steps, extent);
}

function fillTable1Plan(match, workbook, sheet) {
  const exec = executeTable1(match, workbook);
  const resultRows = table1ResultRows(exec);
  const plan = {
    engine: "offline",
    looked_for: match.lookedFor,
    summary: buildTable1Summary(match, exec),
    transform_code: buildTable1TransformCode(match, sheet),
    excel_steps: buildTable1ExcelSteps(match, exec, sheet),
    r_script:
      "# This Table 1 was worked out inside TidyTable, on your computer.\n" +
      "# The result table and the Excel steps above reproduce it exactly.\n" +
      "# A full R version (e.g. tableone::CreateTableOne) arrives with the statistics features.\n",
    r_run_notes:
      "This Table 1 ran on your computer, so there is no R script to run for it yet. " +
      "Use the Excel steps to reproduce the same numbers by hand.",
  };
  return { plan, resultRows, exec };
}

// Public: build the plan and the ready-to-show result rows for a confident match.
export function fillPlan(match, workbook) {
  const sheet = workbook.sheets.find((s) => s.name === match.sheetName) || workbook.sheets[0];

  if (match.intent === "table1") return fillTable1Plan(match, workbook, sheet);
  if (match.intent === "describe") return fillDescribePlan(match, workbook, sheet);
  if (match.topN) return fillTopNPlan(match, workbook, sheet);
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

  // Phase 2 "anticipate & suggest": a count/share answer offers its final
  // level restated in the clinical "n (%)" convention — same numbers the
  // levels table already shows, formatted the way a paper reports them.
  // Deterministic text, no new computation, so no plan/routine implications.
  const last = exec.levels[exec.levels.length - 1];
  if (last && last.denominator) {
    // Phase 7.6: state the denominator in words, and note any blanks in the
    // filter column that sit in that denominator (a novice's most common silent
    // stats error — reading n (%) as if the blanks weren't there).
    const blankNote = last.blankInColumn
      ? `; ${last.blankInColumn} of them blank in "${last.blankColumn}" (still in the denominator)`
      : "";
    plan.companion = {
      kind: "n-percent",
      label: "as n (%) — the way a paper reports it",
      answerText: `${formatNPercent(last.count, last.denominator)} of ${last.denominator} ${last.unit || exec.unit}${blankNote}`,
    };
  }

  return { plan, resultRows, exec };
}
