// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { matchRequest } from "./matcher.js";
import { runOffline } from "./runOffline.js";
import { executeAggregation } from "./cohort.js";
import { fillPlan } from "./fillPlan.js";
import { deriveSheet } from "../workbook.js";

// A3 Level 2: implement offline sum/average/distinct over a resolved numeric
// column, and group-by breakdowns for GROUP_WORDS ("per"/"by"/"grouped by").
// Level 1 (a3-aggregation-words.test.js) only made these decline honestly;
// this file covers the real math, matching Excel steps, and the worker
// transform replay.

function book() {
  const enc = deriveSheet("Encounters", [
    { Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, PatientID: "P1" },
    { Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 6, PatientID: "P2" },
    { Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 5, PatientID: "P3" },
    { Diagnosis: "pneumonia", Drug: "cefpodoxime", Duration_days: "N/A", PatientID: "P4" },
    { Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, PatientID: "P5" },
  ]);
  return { fileName: "m.xlsx", sheets: [enc] };
}

describe("A3 Level 2 — matchRequest resolves average/sum/distinct", () => {
  it("resolves a bare average over a numeric column", () => {
    const result = matchRequest("average duration_days", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.intent).toBe("average");
    expect(result.aggregation).toEqual({ targetColumn: "Duration_days", groupColumn: null });
    expect(result.stages).toHaveLength(0);
  });

  it("resolves total/sum phrasing over a numeric column", () => {
    const result = matchRequest("what is the total duration_days", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.intent).toBe("sum");
    expect(result.aggregation.targetColumn).toBe("Duration_days");
  });

  it("resolves distinct count over a plural column name (diagnoses -> Diagnosis)", () => {
    const result = matchRequest("how many different diagnoses", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.intent).toBe("distinct");
    expect(result.aggregation.targetColumn).toBe("Diagnosis");
  });

  it("combines an aggregation with a cohort filter clause", () => {
    const result = matchRequest("average duration_days for patients with UTI", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.aggregation.targetColumn).toBe("Duration_days");
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0].condition).toMatchObject({ column: "Diagnosis", value: "UTI" });
  });

  it("combines an aggregation with a group-by column", () => {
    const result = matchRequest("average duration_days per diagnosis", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.aggregation).toEqual({ targetColumn: "Duration_days", groupColumn: "Diagnosis" });
  });

  it("still declines honestly when no column can be pinned down", () => {
    const result = matchRequest("average widgetry", book(), { present: false });
    expect(result.status).toBe("none");
    expect(result.reason).toBe("unsupported-average");
  });
});

describe("A3 Level 2 — matchRequest resolves count/proportion group-by breakdowns", () => {
  it("resolves 'per X' as a group-by breakdown, not a decline", () => {
    const result = matchRequest("how many patients per diagnosis", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.groupColumn).toBe("Diagnosis");
  });

  it("a group-by word that isn't a real column falls back to being a filter value", () => {
    // "cephalexin" is a Drug value, not a header — must not be swept up as a
    // (bogus) group-by column.
    const result = matchRequest("how many patients with UTI treated by cephalexin", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.groupColumn).toBeFalsy();
    expect(result.stages).toHaveLength(2);
  });

  it("combines a group-by breakdown with a cohort filter", () => {
    const result = matchRequest("how many patients with UTI per drug", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.groupColumn).toBe("Drug");
    expect(result.stages).toHaveLength(1);
  });
});

describe("A3 Level 2 — executeAggregation computes honestly", () => {
  it("averages a numeric column, skipping non-numeric rows without treating them as 0", () => {
    const match = matchRequest("average duration_days", book(), { present: false });
    const exec = executeAggregation(match, book());
    expect(exec.mode).toBe("single");
    // (10 + 6 + 5 + 3) / 4 = 6, the N/A row is skipped, not counted as 0
    expect(exec.value).toBe(6);
    expect(exec.n).toBe(4);
    expect(exec.skipped).toBe(1);
  });

  it("sums a numeric column", () => {
    const match = matchRequest("total duration_days", book(), { present: false });
    const exec = executeAggregation(match, book());
    expect(exec.value).toBe(24);
    expect(exec.skipped).toBe(1);
  });

  it("counts distinct values of a column", () => {
    const match = matchRequest("how many different diagnoses", book(), { present: false });
    const exec = executeAggregation(match, book());
    expect(exec.value).toBe(3); // UTI, pneumonia, cystitis
  });

  it("breaks an average down per group", () => {
    const match = matchRequest("average duration_days per diagnosis", book(), { present: false });
    const exec = executeAggregation(match, book());
    expect(exec.mode).toBe("group");
    const uti = exec.results.find((g) => g.label === "UTI");
    expect(uti.value).toBe(8); // (10 + 6) / 2
    const pneumonia = exec.results.find((g) => g.label === "pneumonia");
    expect(pneumonia.value).toBe(5); // only the readable 5, N/A skipped
    expect(pneumonia.skipped).toBe(1);
  });
});

describe("A3 Level 2 — fillPlan produces honest Excel steps and a replayable transform", () => {
  it("a single average gets an AVERAGEIFS-teaching step and a matching result row", () => {
    const wb = book();
    const match = matchRequest("average duration_days for patients with UTI", wb, { present: false });
    const { plan, resultRows } = fillPlan(match, wb);
    expect(resultRows).toEqual([{ Average: 8, "Rows used": 2 }]);
    expect(plan.excel_steps[0].formula).toMatch(/^=AVERAGEIFS\(/);
    expect(plan.excel_steps[0].instruction).toMatch(/8/);
  });

  it("a grouped average gets one AVERAGEIFS step per group value", () => {
    const wb = book();
    const match = matchRequest("average duration_days per diagnosis", wb, { present: false });
    const { plan, resultRows } = fillPlan(match, wb);
    expect(resultRows.find((r) => r.Diagnosis === "UTI").Average).toBe(8);
    const utiStep = plan.excel_steps.find((s) => s.title === "UTI");
    expect(utiStep.formula).toMatch(/^=AVERAGEIFS\(/);
    expect(utiStep.formula).toMatch(/"UTI"/);
  });

  it("distinct count gets an honest Remove-Duplicates instruction, not a fragile formula", () => {
    const wb = book();
    const match = matchRequest("how many different diagnoses", wb, { present: false });
    const { plan } = fillPlan(match, wb);
    expect(plan.excel_steps[0].formula).toBe("");
    expect(plan.excel_steps[0].instruction).toMatch(/Remove Duplicates/i);
  });

  it("a group-by count breakdown produces one COUNTIFS step per group and a result row per group", () => {
    const wb = book();
    const match = matchRequest("how many patients per diagnosis", wb, { present: false });
    const { plan, resultRows } = fillPlan(match, wb);
    expect(resultRows).toHaveLength(3);
    const uti = resultRows.find((r) => r.Diagnosis === "UTI");
    expect(uti.Count).toBe(2);
    expect(plan.excel_steps.find((s) => s.title === "UTI").formula).toMatch(/^=COUNTIFS\(/);
  });

  it("the aggregation transform_code reproduces the same average when replayed", () => {
    const wb = book();
    const match = matchRequest("average duration_days per diagnosis", wb, { present: false });
    const { plan } = fillPlan(match, wb);
    const sheets = { Encounters: wb.sheets[0].rows };
    // eslint-disable-next-line no-new-func
    const rows = new Function("sheets", plan.transform_code)(sheets);
    expect(rows.find((r) => r.Diagnosis === "UTI").Average).toBe(8);
  });

  it("the group-count transform_code reproduces the same breakdown when replayed", () => {
    const wb = book();
    const match = matchRequest("how many patients per diagnosis", wb, { present: false });
    const { plan } = fillPlan(match, wb);
    const sheets = { Encounters: wb.sheets[0].rows };
    // eslint-disable-next-line no-new-func
    const rows = new Function("sheets", plan.transform_code)(sheets);
    expect(rows.find((r) => r.Diagnosis === "UTI").Count).toBe(2);
  });
});

describe("A3 Level 2 — runOffline end to end, no key needed", () => {
  it("answers a grouped count offline", () => {
    const res = runOffline("how many patients per diagnosis", book(), {});
    expect(res.kind).toBe("answer");
    expect(res.plan.engine).toBe("offline");
    expect(res.resultRows).toHaveLength(3);
  });

  it("answers an average offline", () => {
    const res = runOffline("what is the average duration_days for patients with UTI", book(), {});
    expect(res.kind).toBe("answer");
    expect(res.resultRows[0].Average).toBe(8);
  });
});
