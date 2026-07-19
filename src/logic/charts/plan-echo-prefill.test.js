import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { resolveChartRequest, stagesToFilterGroup } from "./textToChart.js";

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 5, Ward: "ICU" },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 3, Ward: "General" },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 7, Ward: "General" },
    { PatientID: "P4", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 2, Ward: "ICU" },
    { PatientID: "P5", Diagnosis: "cystitis", Drug: "cefpodoxime", Duration_days: 9, Ward: "ICU" },
  ]);
}

describe("item 7: stagesToFilterGroup (unit)", () => {
  it("turns every plain-equality stage into one condition in one AND-group", () => {
    const stages = [
      { condition: { kind: "value", column: "Diagnosis", op: "=", value: "UTI", negated: false } },
      { condition: { kind: "value", column: "Drug", op: "=", value: "cephalexin", negated: false } },
    ];
    expect(stagesToFilterGroup(stages)).toEqual([
      [{ column: "Diagnosis", value: "UTI" }, { column: "Drug", value: "cephalexin" }],
    ]);
  });

  it("drops a threshold stage, keeping the sibling equality stage", () => {
    const stages = [
      { condition: { kind: "value", column: "Diagnosis", op: "=", value: "UTI", negated: false } },
      { condition: { kind: "threshold", column: "Duration_days", op: ">", value: 7 } },
    ];
    expect(stagesToFilterGroup(stages)).toEqual([[{ column: "Diagnosis", value: "UTI" }]]);
  });

  it("drops a negated equality stage entirely (never approximated)", () => {
    const stages = [{ condition: { kind: "value", column: "Diagnosis", op: "=", value: "UTI", negated: true } }];
    expect(stagesToFilterGroup(stages)).toEqual([[]]);
  });

  it("no stages -> one empty group (no filter)", () => {
    expect(stagesToFilterGroup([])).toEqual([[]]);
    expect(stagesToFilterGroup(undefined)).toEqual([[]]);
  });
});

describe("item 7: resolveChartRequest exposes stages for plan-echo pre-fill", () => {
  it("a single-condition resolved chart carries its stage, widened correctly by stagesToFilterGroup", () => {
    const res = resolveChartRequest("how many patients with UTI by ward", sheet());
    expect(res.status).toBe("resolved");
    expect(res.stages.length).toBe(1);
    expect(stagesToFilterGroup(res.stages)).toEqual([[{ column: "Diagnosis", value: "UTI" }]]);
  });

  it("a multi-condition cohort the quick-chart pipeline declines still exposes both stages for pre-fill (regression: this is exactly what item 7 fixes -- the request is not silently lost, just not auto-charted)", () => {
    const res = resolveChartRequest("how many patients with UTI, of those, cephalexin, by ward", sheet());
    expect(res.status).toBe("none");
    expect(res.reason).toBe("complex-filter");
    expect(res.stages).toHaveLength(2);
    expect(stagesToFilterGroup(res.stages)).toEqual([
      [{ column: "Diagnosis", value: "UTI" }, { column: "Drug", value: "cephalexin" }],
    ]);
  });

  it("regression: the existing quick-chart decline message/behavior for a multi-condition cohort is completely unchanged", () => {
    const res = resolveChartRequest("how many patients with UTI, of those, cephalexin, by ward", sheet());
    expect(res.message).toMatch(/single exact value/i);
  });

  it("regression: an unrelated single-value cohort request still resolves and charts exactly as before", () => {
    const res = resolveChartRequest("average duration_days for patients with UTI by ward", sheet());
    expect(res.status).toBe("resolved");
    expect(res.filter).toEqual({ column: "Diagnosis", value: "UTI" });
    expect(res.aggMode).toBe("average");
  });
});
