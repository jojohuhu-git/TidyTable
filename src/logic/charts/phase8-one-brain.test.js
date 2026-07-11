import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { resolveChartRequest } from "./textToChart.js";
import { buildDataset } from "./aggregate.js";

// Phase 8.1 — "one brain, two steps". A chart request now runs through the SAME
// Step 3 pipeline (matchRequest) first, so cohort filters, top-N and exact
// aggregation resolution transfer to charts for free — and a cohort the chart
// can't honestly draw is declined, never silently mis-drawn.

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 5, Ward: "ICU" },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 3, Ward: "General" },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 7, Ward: "General" },
    { PatientID: "P4", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 2, Ward: "ICU" },
    { PatientID: "P5", Diagnosis: "cystitis", Drug: "cefpodoxime", Duration_days: 9, Ward: "ICU" },
  ]);
}

describe("Phase 8.1 — the shared pipeline resolves exact chart requests (via step3)", () => {
  it("routes an exact average-by-group through matchRequest", () => {
    const res = resolveChartRequest("average duration_days by ward", sheet());
    expect(res.status).toBe("resolved");
    expect(res.via).toBe("step3");
    expect(res.labelCol).toBe("Ward");
    expect(res.valueCol).toBe("Duration_days");
    expect(res.aggMode).toBe("average");
    expect(res.confidence).toBe("exact");
    expect(res.filter).toBeNull();
  });

  it("routes an exact total-by-group through matchRequest", () => {
    const res = resolveChartRequest("total duration_days by ward", sheet());
    expect(res.via).toBe("step3");
    expect(res.aggMode).toBe("sum");
    expect(res.valueCol).toBe("Duration_days");
    expect(res.labelCol).toBe("Ward");
  });

  it("routes a frequency top-N through matchRequest, mapping the Infinity default to no cap", () => {
    const res = resolveChartRequest("top 2 drug", sheet());
    expect(res.via).toBe("step3");
    expect(res.labelCol).toBe("Drug");
    expect(res.rank).toEqual({ n: 2, direction: "most" });

    const least = resolveChartRequest("least common drug", sheet());
    expect(least.via).toBe("step3");
    expect(least.rank).toEqual({ n: null, direction: "least" });
  });
});

describe("Phase 8.1 — a cohort filter now transfers from Step 3 into the chart", () => {
  it("charts an average scoped to a single-value cohort ('for patients with UTI')", () => {
    const res = resolveChartRequest("average duration_days for patients with UTI by ward", sheet());
    expect(res.status).toBe("resolved");
    expect(res.via).toBe("step3");
    expect(res.labelCol).toBe("Ward");
    expect(res.valueCol).toBe("Duration_days");
    expect(res.aggMode).toBe("average");
    expect(res.filter).toEqual({ column: "Diagnosis", value: "UTI" });

    // The filter carries into the dataset — identical numbers by hand.
    const ds = buildDataset(sheet(), res.labelCol, res.valueCol, { aggMode: res.aggMode, filter: res.filter });
    const byLabel = Object.fromEntries(ds.points.map((p) => [p.label, p.value]));
    // UTI rows: ICU {5, 2} → avg 3.5 ; General {7} → avg 7.
    expect(byLabel).toEqual({ General: 7, ICU: 3.5 });
  });

  it("charts a count broken down by a group, scoped to a cohort", () => {
    const res = resolveChartRequest("how many patients with UTI by ward", sheet());
    expect(res.status).toBe("resolved");
    expect(res.via).toBe("step3");
    expect(res.labelCol).toBe("Ward");
    expect(res.aggMode).toBe("count");
    expect(res.filter).toEqual({ column: "Diagnosis", value: "UTI" });
  });
});

describe("Phase 8.1 — honesty: a cohort the chart can't draw is declined, never mis-drawn", () => {
  it("declines a threshold cohort plainly instead of silently ignoring it", () => {
    const res = resolveChartRequest("how many patients with duration_days over 7 by ward", sheet());
    expect(res.status).toBe("none");
    expect(res.reason).toBe("complex-filter");
    expect(res.message).toMatch(/single exact value/i);
  });
});

describe("Phase 8.1 — chart-only phrasings still fall back to the local parser", () => {
  it("a bare 'patients by ward' is a chart, resolved by the local fallback (no via)", () => {
    const res = resolveChartRequest("patients by ward", sheet());
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Ward");
    expect(res.aggMode).toBe("count");
    expect(res.via).toBeUndefined();
  });

  it("a value-only scope ('cephalexin by ward') still resolves via the local fallback", () => {
    const res = resolveChartRequest("cephalexin by ward", sheet());
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Ward");
    expect(res.filter).toEqual({ column: "Drug", value: "cephalexin" });
    expect(res.via).toBeUndefined();
  });
});
