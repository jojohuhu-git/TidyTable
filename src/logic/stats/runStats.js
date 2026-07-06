// Orchestrate a statistical comparison and assemble it in the OpenEpi
// show-the-work order (build prompt §9). The caller picks two columns; this
// figures out the right test, builds the table the numbers come from, applies the
// expected-count rule (switching to Fisher when chi-square would be unreliable),
// and returns every piece to display: the table, expected counts, the test-choice
// reason, the statistic and p, the effect size with a 95% interval, and the
// values to retype into OpenEpi. Language is association, never causation.

import { chiSquare, fisherExact } from "./contingency.js";
import { tTestWelch } from "./ttest.js";
import { ciProportion, oddsRatio, riskRatio, ciMeanDiff } from "./effect.js";
import { foldKey } from "../checkup/normalizers.js";

function isNumeric(sheet, col) {
  const h = sheet.headers.find((x) => x.name === col);
  if (h && (h.type === "number" || h.type === "mixed (text + numbers)")) return true;
  const vals = sheet.rows.map((r) => r[col]).filter((v) => v != null);
  return vals.length > 0 && vals.every((v) => typeof v === "number" || (!isNaN(Number(v)) && String(v).trim() !== ""));
}

// Distinct values of a column in the order they first appear.
function levelsOf(sheet, col) {
  const seen = new Map();
  for (const r of sheet.rows) {
    const v = r[col];
    if (v == null || String(v).trim() === "") continue;
    const k = foldKey(v);
    if (!seen.has(k)) seen.set(k, v);
  }
  return [...seen.values()];
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

// Public: analyze two columns of a sheet. Returns { ok, kind, steps, ... } where
// `steps` is the ordered show-the-work content for the UI.
export function analyze(sheet, colA, colB, level = 0.95) {
  const aNum = isNumeric(sheet, colA);
  const bNum = isNumeric(sheet, colB);

  // One number + one two-level category → two-sample t-test.
  if (aNum !== bNum) {
    const numCol = aNum ? colA : colB;
    const grpCol = aNum ? colB : colA;
    const groups = levelsOf(sheet, grpCol);
    if (groups.length !== 2) {
      return unsupported(`To compare an average, the grouping column "${grpCol}" needs exactly two groups; it has ${groups.length}.`);
    }
    return tTestResult(sheet, numCol, grpCol, groups, level);
  }

  // Both categorical → contingency table.
  if (!aNum && !bNum) {
    return contingencyResult(sheet, colA, colB, level);
  }

  // Both numeric — out of scope for these simple tests.
  return unsupported("Both columns are numbers. These tests compare a group against an outcome; pick one grouping column and one outcome column.");
}

function unsupported(message) {
  return { ok: false, message };
}

function tTestResult(sheet, numCol, grpCol, groups, level) {
  const valuesFor = (g) =>
    sheet.rows
      .filter((r) => r[grpCol] != null && foldKey(r[grpCol]) === foldKey(g))
      .map((r) => Number(r[numCol]))
      .filter((n) => Number.isFinite(n));
  const a = valuesFor(groups[0]);
  const b = valuesFor(groups[1]);
  if (a.length < 2 || b.length < 2) {
    return unsupported(`Each group needs at least two numeric values in "${numCol}".`);
  }
  const tt = tTestWelch(a, b);
  const ci = ciMeanDiff(tt, level);
  const steps = [
    { title: "The groups being compared", kind: "ttest-table", data: {
      grpCol, numCol,
      rows: [
        { group: String(groups[0]), n: tt.nA, mean: round(tt.meanA), sd: round(tt.sdA) },
        { group: String(groups[1]), n: tt.nB, mean: round(tt.meanB), sd: round(tt.sdB) },
      ],
    } },
    { title: "Which test and why", kind: "note", body:
      `A two-sample t-test compares the average "${numCol}" between the two groups. Welch's version is used, which does not assume the two groups vary by the same amount.` },
    { title: "The test result", kind: "stat", data: { name: "t", statistic: round(tt.statistic), df: round(tt.df, 1), p: formatP(tt.p) } },
    { title: "How big is the difference", kind: "effect", data: {
      measure: "difference in average " + numCol, value: round(tt.diff), lo: round(ci.lo), hi: round(ci.hi), level } },
    { title: "Check this yourself", kind: "crosscheck-ttest", data: { a, b, groups: groups.map(String), numCol } },
  ];
  return {
    ok: true, kind: "ttest", testName: "Two-sample t-test (Welch)",
    numCol, grpCol,
    p: tt.p, statistic: tt.statistic, df: tt.df, steps,
    conclusion: associationLine("a difference in average " + numCol + " between the groups", tt.p),
  };
}

function contingencyResult(sheet, colA, colB, level) {
  const rowLevels = levelsOf(sheet, colA); // groups (rows)
  const colLevels = levelsOf(sheet, colB); // outcome (columns)
  if (rowLevels.length < 2 || colLevels.length < 2) {
    return unsupported(`Both columns need at least two values to build a comparison table. "${colA}" has ${rowLevels.length}, "${colB}" has ${colLevels.length}.`);
  }
  // Build the counts.
  const counts = rowLevels.map((rv) =>
    colLevels.map((cv) =>
      sheet.rows.filter((r) => r[colA] != null && r[colB] != null && foldKey(r[colA]) === foldKey(rv) && foldKey(r[colB]) === foldKey(cv)).length,
    ),
  );
  const chi = chiSquare(counts);
  const is2x2 = rowLevels.length === 2 && colLevels.length === 2;

  // The test-choice rule: switch to Fisher when an expected count is below 5.
  let primary = chi;
  let choiceNote =
    `All expected counts are 5 or more (smallest is ${round(chi.minExpected, 1)}), so the chi-square test is reliable here.`;
  if (is2x2 && chi.minExpected < 5) {
    const [[a, b], [c, d]] = counts;
    const fish = fisherExact(a, b, c, d);
    primary = { ...fish, df: null };
    choiceNote =
      `One expected count is below 5 (the smallest is ${round(chi.minExpected, 1)}), so Fisher's exact test is used instead of chi-square, which would be unreliable here.`;
  }

  const steps = [
    { title: "The table these numbers come from", kind: "table", data: {
      rowName: colA, colName: colB, rowLevels: rowLevels.map(String), colLevels: colLevels.map(String),
      counts, rowTot: chi.rowTot, colTot: chi.colTot, grand: chi.grand } },
    { title: "Expected counts if the two were unrelated", kind: "expected", data: {
      rowLevels: rowLevels.map(String), colLevels: colLevels.map(String),
      expected: chi.expected.map((row) => row.map((e) => round(e, 1))), min: round(chi.minExpected, 1) } },
    { title: "Which test and why", kind: "note", body: choiceNote },
    { title: "The test result", kind: "stat", data:
      primary.test === "fisher"
        ? { name: "Fisher's exact test", statistic: null, df: null, p: formatP(primary.p) }
        : { name: "chi-square", statistic: round(primary.statistic), df: primary.df, p: formatP(primary.p) } },
  ];

  if (is2x2) {
    const [[a, b], [c, d]] = counts;
    const or = oddsRatio(a, b, c, d, level);
    const rr = riskRatio(a, b, c, d, level);
    steps.push({ title: "How strong is the association", kind: "effect2x2", data: {
      outcome: String(colLevels[0]), group1: String(rowLevels[0]), group2: String(rowLevels[1]),
      or: { value: round(or.value), lo: round(or.lo), hi: round(or.hi), corrected: or.corrected },
      rr: { value: round(rr.value), lo: round(rr.lo), hi: round(rr.hi), corrected: rr.corrected },
      level } });
    steps.push({ title: "Check this yourself at OpenEpi", kind: "crosscheck2x2", data: {
      cells: { a, b, c, d }, rowLevels: rowLevels.map(String), colLevels: colLevels.map(String) } });
  }

  return {
    ok: true, kind: "contingency", is2x2, testName: primary.test === "fisher" ? "Fisher's exact test" : "Chi-square test",
    colA, colB, useFisher: primary.test === "fisher",
    p: primary.p, statistic: primary.statistic ?? null, df: primary.df ?? null, steps,
    conclusion: associationLine(`an association between "${colA}" and "${colB}"`, primary.p),
  };
}

// Never causal (build prompt §9): "associated with", not "caused by".
function associationLine(what, p) {
  if (p < 0.05) {
    return `The data show ${what} (p ${formatP(p)}). This is an association only; it does not show that one thing brings about the other.`;
  }
  return `The data do not show ${what} at the usual 0.05 cutoff (p ${formatP(p)}). That is not proof there is no association — the study may simply be too small to detect one.`;
}

export function formatP(p) {
  if (p < 0.001) return "< 0.001";
  return round(p, 3).toString();
}
