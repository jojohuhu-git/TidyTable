import { describe, it, expect } from "vitest";
import { toNumber, predicate, executeCohort } from "./cohort.js";
import { fillPlan } from "./fillPlan.js";
import { deriveSheet } from "../workbook.js";

// P0-2: toNumber must not treat non-numeric text as 0.
describe("P0-2 — toNumber returns null for non-numeric text", () => {
  it("returns null for N/A, pending, unknown", () => {
    expect(toNumber("N/A")).toBe(null);
    expect(toNumber("pending")).toBe(null);
    expect(toNumber("unknown")).toBe(null);
  });
  it("does not silently accept a leading censored marker", () => {
    expect(toNumber("<5")).toBe(null);
    expect(toNumber(">100")).toBe(null);
  });
  it("still parses plain numbers and $/,-formatted numbers", () => {
    expect(toNumber(7)).toBe(7);
    expect(toNumber("$1,200")).toBe(1200);
    expect(toNumber("1,204")).toBe(1204);
  });
  it("a mixed range like 12-14 is not treated as a number", () => {
    expect(toNumber("12-14")).toBe(null);
  });
});

// NEW-2: unit-suffix durations must not be dropped by the stricter toNumber.
describe("NEW-2 — toNumber strips a trailing unit suffix before coercion", () => {
  it("coerces '5 Days' / '365 Days' but still rejects N/A", () => {
    expect(toNumber("5 Days")).toBe(5);
    expect(toNumber("365 Days")).toBe(365);
    expect(toNumber(3)).toBe(3);
    expect(toNumber("N/A")).toBe(null);
  });
});

describe("P0-2 — a threshold predicate does not count N/A rows as 0", () => {
  it("does not match N/A against duration < 7", () => {
    const pred = predicate({ kind: "threshold", column: "Duration", op: "<", value: 7 });
    expect(pred({ Duration: "N/A" })).toBe(false);
    expect(pred({ Duration: 5 })).toBe(true);
  });
});

function matchFixture(rows) {
  const sheet = deriveSheet("Patients", rows);
  return {
    match: {
      sheetName: "Patients",
      lookedFor: "Counting rows where Duration is under 7",
      grainMode: "row",
      grain: null,
      stages: [{ condition: { kind: "threshold", column: "Duration", op: "<", value: 7, term: '"Duration" is under 7' } }],
    },
    workbook: { sheets: [sheet] },
    sheet,
  };
}

describe("P0-2 — executeCohort surfaces skipped non-numeric rows honestly", () => {
  it("excludes N/A rows from the count and reports how many were skipped", () => {
    const { match, workbook } = matchFixture([
      { Duration: 5 },
      { Duration: "N/A" },
      { Duration: "N/A" },
      { Duration: 10 },
      { Duration: "5 Days" },
    ]);
    const exec = executeCohort(match, workbook);
    // Only 5 and "5 Days" (5) are < 7; the two N/A rows must not count as 0.
    expect(exec.levels[0].count).toBe(2);
    expect(exec.levels[0].skippedCount).toBe(2);
    expect(exec.levels[0].skippedColumn).toBe("Duration");
  });

  it("fillPlan summary mentions the skipped rows in plain English", () => {
    const { match, workbook } = matchFixture([
      { Duration: 5 }, { Duration: "N/A" }, { Duration: "N/A" }, { Duration: 10 }, { Duration: "5 Days" },
    ]);
    const { plan } = fillPlan(match, workbook);
    expect(plan.summary).toMatch(/2 rows had no readable number in "Duration" and were not counted/);
  });

  it("the generated transform_code agrees with executeCohort on a fixture with N/A values", () => {
    const { match, workbook, sheet } = matchFixture([
      { Duration: 5 }, { Duration: "N/A" }, { Duration: "N/A" }, { Duration: 10 }, { Duration: "5 Days" },
    ]);
    const { plan, resultRows } = fillPlan(match, workbook);
    const sheets = { Patients: sheet.rows };
    // eslint-disable-next-line no-new-func
    const out = new Function("sheets", plan.transform_code)(sheets);
    expect(out).toEqual(resultRows);
    expect(out[0]["Matched"]).toBe(2);
    expect(out[0]["What was checked"]).toBe(resultRows[0]["What was checked"]);
  });
});
