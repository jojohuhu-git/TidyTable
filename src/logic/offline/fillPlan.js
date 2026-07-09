// Turn a confident cohort match into a PLAN_SCHEMA-shaped plan (build prompt §8,
// §12). Like buildFixPlan, the output carries engine:"offline" and every schema
// field, plus `looked_for` — the trust line the UI always shows so a wrong read
// is visible before anyone trusts the number. The transform recomputes the same
// counts so re-running on new data stays honest.

import { executeCohort, toNumber } from "./cohort.js";

const RESULT_KEYS = { checked: "What was checked", matched: "Matched", out: "Out of", share: "Share" };

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
  const lastRow = sheet.rows.length + 1;
  const range = (col) => `'${sheet.name}'!${letterFor(sheet, col)}2:${letterFor(sheet, col)}${lastRow}`;
  const crit = (op, value) => (op === "=" ? `"${value}"` : `"${op}${value}"`);

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
      if (c.when) pairs.push(`${range(c.when.column)}, "${c.when.value}"`);
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
  return steps;
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
  if (c.kind === "value") { return r[c.column] != null && foldKey(r[c.column]) === foldKey(c.value); }
  if (c.kind === "set") { var set = {}; for (var i = 0; i < c.values.length; i++) { set[foldKey(c.values[i])] = 1; } return r[c.column] != null && set[foldKey(r[c.column])] === 1; }
  if (c.kind === "threshold") { if (c.when) { var wv = r[c.when.column]; if (wv == null || foldKey(wv) !== foldKey(c.when.value)) return false; } var n = toNumber(r[c.column]); if (n == null) return false; return cmp(n, c.op, c.value); }
  return false;
}; };
var out = [];
if (GRAIN) {
  var groups = {}; var order = [];
  for (var i = 0; i < rows.length; i++) { var v = rows[i][GRAIN.entityColumn]; if (v == null || String(v).trim() === "") continue; var k = foldKey(v); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(rows[i]); }
  var ents = order.map(function (k) { return groups[k]; });
  var prev = ents.length;
  for (var s = 0; s < STAGES.length; s++) { var p = pred(STAGES[s]); ents = ents.filter(function (g) { return g.some(p); }); var row = {}; row[${JSON.stringify(RESULT_KEYS.checked)}] = STAGES[s].term; row[${JSON.stringify(RESULT_KEYS.matched)}] = ents.length; row[${JSON.stringify(RESULT_KEYS.out)}] = prev; row[${JSON.stringify(RESULT_KEYS.share)}] = (prev ? Math.round(ents.length / prev * 1000) / 10 : 0) + "%"; out.push(row); prev = ents.length; }
} else {
  var cur = rows; var prevR = rows.length;
  for (var s2 = 0; s2 < STAGES.length; s2++) { var p2 = pred(STAGES[s2]); cur = cur.filter(p2); var row2 = {}; row2[${JSON.stringify(RESULT_KEYS.checked)}] = STAGES[s2].term; row2[${JSON.stringify(RESULT_KEYS.matched)}] = cur.length; row2[${JSON.stringify(RESULT_KEYS.out)}] = prevR; row2[${JSON.stringify(RESULT_KEYS.share)}] = (prevR ? Math.round(cur.length / prevR * 1000) / 10 : 0) + "%"; out.push(row2); prevR = cur.length; }
}
return out;
`.trim();
}

// Public: build the plan and the ready-to-show result rows for a confident match.
export function fillPlan(match, workbook) {
  const sheet = workbook.sheets.find((s) => s.name === match.sheetName) || workbook.sheets[0];
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
