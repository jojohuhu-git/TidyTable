import { describe, it, expect } from "vitest";
import { matchRequest } from "./matcher.js";
import { executePooledRank } from "./cohort.js";
import { fillPlan } from "./fillPlan.js";
import { deriveSheet } from "../workbook.js";
import { poolKeyFor } from "./pooledPolicyStore.js";

function runTransformOf(plan, wb) {
  const sheets = { Dx: wb.sheets[0].rows };
  // eslint-disable-next-line no-new-func
  return new Function("sheets", plan.transform_code)(sheets);
}

// P1-4a — matcher detection for pooled multi-column ranking ("most common
// value across Primary and Secondary"). The engine layer (cohort.js) is
// covered by fix-2026-07-11-p1-4-pooled-rank.test.js; this file covers
// recognizing the phrasing, resolving the 2+ columns, and the counting-policy
// clarify gate (Decision D — never silently defaulted).

function book() {
  const dx = deriveSheet("Dx", [
    { PatientID: "P1", Primary: "UTI", Secondary: "sepsis" },
    { PatientID: "P1", Primary: "UTI", Secondary: "" },
    { PatientID: "P2", Primary: "pyelonephritis", Secondary: "UTI" },
    { PatientID: "P3", Primary: "sepsis", Secondary: "sepsis" },
    { PatientID: "P4", Primary: "", Secondary: "UTI" },
  ]);
  return { fileName: "dx.xlsx", sheets: [dx] };
}

describe("P1-4a matcher — pooled phrasing detection", () => {
  it("an ordinary single-column request never triggers pooling", () => {
    const wb = book();
    const m = matchRequest("most common Primary", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.intent).toBe("topN");
  });

  it("'most common value across X and Y' with no policy on file yet asks first (never silently defaults)", () => {
    const wb = book();
    const m = matchRequest("most common value across Primary and Secondary", wb, { present: false });
    expect(m.status).toBe("needs_pooled_policy");
    expect(m.columns).toEqual(["Primary", "Secondary"]);
    expect(m.suggestedPolicy).toBe("occurrence");
    expect(m.entityColumn).toBe("PatientID");
    expect(m.poolKey).toBe(poolKeyFor(["Primary", "Secondary"]));
  });

  it("an explicit pooledPolicy answer resolves to a confident pooled match", () => {
    const wb = book();
    const m = matchRequest("most common value across Primary and Secondary", wb, { present: false }, { pooledPolicy: "row" });
    expect(m.status).toBe("confident");
    expect(m.intent).toBe("pooledRank");
    expect(m.pooled).toEqual({ columns: ["Primary", "Secondary"], policy: "row", n: Infinity, direction: "most", entityColumn: null });
    expect(m.lookedFor).toMatch(/Pooling "Primary" \+ "Secondary"/);
    const exec = executePooledRank(m, wb);
    expect(exec.ranked.map((e) => [e.label, e.count])).toEqual([["UTI", 4], ["sepsis", 2], ["pyelonephritis", 1]]);
  });

  it("a remembered policy (pooledPolicyChoices) is honored without asking again", () => {
    const wb = book();
    const choices = { [poolKeyFor(["Primary", "Secondary"])]: { policy: "patient", entityColumn: "PatientID" } };
    const m = matchRequest(
      "most common value across Primary and Secondary",
      wb, { present: false },
      { pooledPolicyChoices: choices },
    );
    expect(m.status).toBe("confident");
    expect(m.pooled.policy).toBe("patient");
    expect(m.pooled.entityColumn).toBe("PatientID");
    const exec = executePooledRank(m, wb);
    expect(exec.ranked.map((e) => [e.label, e.count])).toEqual([["UTI", 3], ["sepsis", 2], ["pyelonephritis", 1]]);
  });

  it("honors a stated 'top N' cap", () => {
    const wb = book();
    const m = matchRequest(
      "top 1 most common value across Primary and Secondary",
      wb, { present: false },
      { pooledPolicy: "occurrence" },
    );
    expect(m.status).toBe("confident");
    expect(m.pooled.n).toBe(1);
    const exec = executePooledRank(m, wb);
    expect(exec.ranked.map((e) => e.label)).toEqual(["UTI"]);
  });

  it("'combine X and Y and rank the types' also triggers pooling", () => {
    const wb = book();
    const m = matchRequest(
      "combine Primary and Secondary and rank the types",
      wb, { present: false },
      { pooledPolicy: "occurrence" },
    );
    expect(m.status).toBe("confident");
    expect(m.intent).toBe("pooledRank");
    expect(m.pooled.columns).toEqual(["Primary", "Secondary"]);
  });
});

describe("P1-4a — fillPlan output (result table, Excel steps, R script, worker transform)", () => {
  it("builds a result table whose worker transform reproduces the same numbers", () => {
    const wb = book();
    const m = matchRequest(
      "most common value across Primary and Secondary",
      wb, { present: false },
      { pooledPolicy: "occurrence" },
    );
    expect(m.status).toBe("confident");
    const { plan, resultRows } = fillPlan(m, wb);
    expect(resultRows).toEqual([
      { Value: "UTI", Count: 4, "Share of total": "50%" },
      { Value: "sepsis", Count: 3, "Share of total": "37.5%" },
      { Value: "pyelonephritis", Count: 1, "Share of total": "12.5%" },
    ]);
    expect(plan.summary).toMatch(/Pooling "Primary" \+ "Secondary"/);
    expect(plan.excel_steps.length).toBeGreaterThan(0);
    expect(plan.r_script).toMatch(/pivot_longer/);
    expect(runTransformOf(plan, wb)).toEqual(resultRows);
  });

  it("patient policy's worker transform also reproduces the app's numbers", () => {
    const wb = book();
    const m = matchRequest(
      "most common value across Primary and Secondary",
      wb, { present: false },
      { pooledPolicy: "patient" },
    );
    const { plan, resultRows } = fillPlan(m, wb);
    expect(resultRows.map((r) => [r.Value, r.Count])).toEqual([["UTI", 3], ["sepsis", 2], ["pyelonephritis", 1]]);
    expect(plan.r_script).toMatch(/distinct/);
    expect(runTransformOf(plan, wb)).toEqual(resultRows);
  });
});
