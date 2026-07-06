import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { analyze, formatP } from "./runStats.js";
import { assessRegression } from "./epvWizard.js";
import { rRegression, rTTest, rChiSquare } from "../rscripts/templates.js";

// Build a sheet with the given 2x2 counts for a Group×Outcome table.
function tableSheet([[a, b], [c, d]]) {
  const rows = [];
  const add = (group, outcome, n) => { for (let i = 0; i < n; i++) rows.push({ Group: group, Outcome: outcome }); };
  add("A", "yes", a); add("A", "no", b); add("B", "yes", c); add("B", "no", d);
  return deriveSheet("Data", rows);
}

function numericSheet() {
  const rows = [];
  [1, 2, 3, 4, 5].forEach((v) => rows.push({ Group: "A", Value: v }));
  [3, 4, 5, 6, 7].forEach((v) => rows.push({ Group: "B", Value: v }));
  return deriveSheet("Data", rows);
}

// --- scenario 5 -------------------------------------------------------------

describe("scenario 5: 2x2 with all expected counts large → chi-square", () => {
  const res = analyze(tableSheet([[12, 8], [5, 15]]), "Group", "Outcome");

  it("builds the table with totals", () => {
    const table = res.steps.find((s) => s.kind === "table");
    expect(table.data.grand).toBe(40);
    expect(table.data.counts).toEqual([[12, 8], [5, 15]]);
  });
  it("shows expected counts", () => {
    const exp = res.steps.find((s) => s.kind === "expected");
    expect(exp.data.expected[0][0]).toBeCloseTo(8.5, 1);
  });
  it("uses chi-square and states all expected are large enough", () => {
    expect(res.testName).toBe("Chi-square test");
    expect(res.steps.find((s) => s.kind === "note").body).toMatch(/5 or more/i);
  });
  it("reports odds ratio and risk ratio with intervals", () => {
    const eff = res.steps.find((s) => s.kind === "effect2x2");
    expect(eff.data.or.value).toBeCloseTo(4.5, 1);
    expect(eff.data.or.lo).toBeGreaterThan(1);
  });
  it("gives an OpenEpi cross-check with the four cells", () => {
    const cc = res.steps.find((s) => s.kind === "crosscheck2x2");
    expect(cc.data.cells).toEqual({ a: 12, b: 8, c: 5, d: 15 });
  });
  it("uses association language, never causation", () => {
    expect(res.conclusion).toMatch(/association/i);
    expect(res.conclusion).not.toMatch(/cause[sd]?\b/i);
  });
});

describe("scenario 5: 2x2 with a small expected count → auto-switch to Fisher", () => {
  const res = analyze(tableSheet([[1, 9], [8, 2]]), "Group", "Outcome");
  it("switches to Fisher and states the reason", () => {
    expect(res.testName).toBe("Fisher's exact test");
    expect(res.steps.find((s) => s.kind === "note").body).toMatch(/below 5.*Fisher/i);
  });
  it("still shows the built table and expected counts first", () => {
    expect(res.steps[0].kind).toBe("table");
    expect(res.steps[1].kind).toBe("expected");
  });
});

describe("t-test path", () => {
  const res = analyze(numericSheet(), "Group", "Value");
  it("recognizes one number + one two-level group", () => {
    expect(res.kind).toBe("ttest");
    expect(res.testName).toMatch(/t-test/i);
  });
  it("shows the difference in means with an interval", () => {
    const eff = res.steps.find((s) => s.kind === "effect");
    expect(eff.data.value).toBeCloseTo(-2, 5);
    expect(eff.data.lo).toBeLessThan(-2);
  });
});

// --- scenario 6 -------------------------------------------------------------

describe("scenario 6: regression appropriateness gate", () => {
  it("refuses 38 events with 9 predictors, explaining why", () => {
    const v = assessRegression({ outcomeType: "yesno", repeated: false, events: 38, predictors: 9 });
    expect(v.decision).toBe("refuse");
    expect(v.message).toMatch(/38/);
    expect(v.message).toMatch(/per variable/i);
  });
  it("proceeds with 38 events and 3 predictors, choosing logistic", () => {
    const v = assessRegression({ outcomeType: "yesno", repeated: false, events: 38, predictors: 3 });
    expect(v.decision).toBe("proceed");
    expect(v.method).toBe("logistic");
    expect(v.checklist.length).toBeGreaterThan(0);
  });
  it("refuses repeated/matched data regardless of counts", () => {
    const v = assessRegression({ outcomeType: "yesno", repeated: true, events: 500, predictors: 2 });
    expect(v.decision).toBe("refuse");
    expect(v.message).toMatch(/statistician/i);
  });
});

describe("R script templates follow the console-only novice contract", () => {
  it("logistic script uses glm/binomial, file.choose, guarded install, dual keystrokes", () => {
    const { script } = rRegression("logistic", { outcomeCol: "Died", predictors: ["Age", "Sex"] });
    expect(script).toMatch(/glm\(/);
    expect(script).toMatch(/family = binomial/);
    expect(script).toMatch(/file\.choose\(\)/);
    expect(script).toMatch(/if \(!require\("readxl"\)\)/);
    expect(script).toMatch(/Ctrl\+Enter.*Cmd\+Enter/);
    expect(script).not.toMatch(/menu|toolbar|pane on the/i);
  });
  it("t-test and chi-square scripts include an expected-output block", () => {
    expect(rTTest("Value", "Group").r_run_notes).toMatch(/you should see something like/i);
    expect(rChiSquare("Group", "Outcome", true).script).toMatch(/fisher\.test/);
  });
});

describe("p formatting", () => {
  it("shows tiny p as < 0.001", () => expect(formatP(0.0004)).toBe("< 0.001"));
});
