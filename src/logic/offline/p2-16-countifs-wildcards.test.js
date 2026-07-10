import { describe, it, expect } from "vitest";
import { fillPlan } from "./fillPlan.js";
import { deriveSheet } from "../workbook.js";

// P2-16: *, ?, ~ are wildcards inside a COUNTIFS/SUMIFS/AVERAGEIFS criterion.
// A cell value that literally contains one (e.g. "Dept*A") would otherwise be
// wildcard-matched by Excel while the app matched it as an exact string —
// escape with ~ so the Excel formula agrees with the app.
function matchFixture(rows, value) {
  const sheet = deriveSheet("Patients", rows);
  return {
    match: {
      sheetName: "Patients",
      lookedFor: `Counting rows where Dept is "${value}"`,
      grainMode: "row",
      grain: null,
      stages: [{ condition: { kind: "value", column: "Dept", op: "=", value, term: `"Dept" is "${value}"` } }],
    },
    workbook: { sheets: [sheet] },
  };
}

describe("P2-16 — COUNTIFS criteria escape Excel wildcard characters", () => {
  it("escapes a literal * in the matched value", () => {
    const { match, workbook } = matchFixture([{ Dept: "Dept*A" }, { Dept: "DeptXA" }], "Dept*A");
    const { plan } = fillPlan(match, workbook);
    const step = plan.excel_steps.find((s) => s.formula);
    expect(step.formula).toMatch(/"Dept~\*A"/);
  });

  it("escapes a literal ? in the matched value", () => {
    const { match, workbook } = matchFixture([{ Dept: "A?B" }], "A?B");
    const { plan } = fillPlan(match, workbook);
    const step = plan.excel_steps.find((s) => s.formula);
    expect(step.formula).toMatch(/"A~\?B"/);
  });

  it("escapes a literal ~ in the matched value", () => {
    const { match, workbook } = matchFixture([{ Dept: "A~B" }], "A~B");
    const { plan } = fillPlan(match, workbook);
    const step = plan.excel_steps.find((s) => s.formula);
    expect(step.formula).toMatch(/"A~~B"/);
  });
});
