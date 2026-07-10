import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { resolveChartRequest } from "./textToChart.js";
import { buildDataset, applyRankCap } from "./aggregate.js";

// Phase 4 (2026-07-10): the Step 9 mirror of the Q&A most-common/top-N
// ranking family — "top 5 drugs" caps the bar chart the same way it caps the
// Q&A ranked table.

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Drug: "cephalexin", Diagnosis: "UTI" },
    { PatientID: "P2", Drug: "cephalexin", Diagnosis: "UTI" },
    { PatientID: "P3", Drug: "amoxicillin", Diagnosis: "pneumonia" },
    { PatientID: "P4", Drug: "amoxicillin", Diagnosis: "pneumonia" },
    { PatientID: "P5", Drug: "cefpodoxime", Diagnosis: "cystitis" },
  ]);
}

describe("Phase 4 — resolveChartRequest picks up the ranking family", () => {
  it("'top 2 drug' resolves the Drug column and carries a rank cap of 2", () => {
    // Note: the chart-side label search (unlike the Q&A matcher) has no
    // plural->singular fallback — a pre-existing gap, not a Phase 4
    // regression (see the handoff's judgment-calls section).
    const res = resolveChartRequest("top 2 drug", sheet());
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Drug");
    expect(res.aggMode).toBe("count");
    expect(res.rank).toEqual({ n: 2, direction: "most" });
  });

  it("'least common drug' carries direction 'least' with no cap", () => {
    const res = resolveChartRequest("least common drug", sheet());
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Drug");
    expect(res.rank).toEqual({ n: null, direction: "least" });
  });

  it("a request with no ranking wording carries no rank field", () => {
    const res = resolveChartRequest("drugs by diagnosis", sheet());
    expect(res.status).toBe("resolved");
    expect(res.rank).toBeNull();
  });
});

describe("Phase 4 — applyRankCap caps and reorders a categorical dataset", () => {
  it("caps a bar chart dataset to the top N, sorted descending", () => {
    const ds = buildDataset(sheet(), "Drug", null);
    const capped = applyRankCap(ds, { n: 2, direction: "most" });
    expect(capped.points.map((p) => p.label)).toEqual(["cephalexin", "amoxicillin"]);
    expect(capped.rankRequestedN).toBe(2);
    expect(capped.rankShown).toBe(2);
  });

  it("'least' direction reorders ascending", () => {
    const ds = buildDataset(sheet(), "Drug", null);
    const capped = applyRankCap(ds, { n: null, direction: "least" });
    expect(capped.points.map((p) => p.value)).toEqual([1, 2, 2]);
  });

  it("a tie at the cutoff is shown in full, flagged so the panel can say so", () => {
    const ds = buildDataset(sheet(), "Drug", null); // cephalexin:2, amoxicillin:2, cefpodoxime:1
    const capped = applyRankCap(ds, { n: 1, direction: "most" });
    expect(capped.points).toHaveLength(2); // both tied at 2
    expect(capped.rankRequestedN).toBe(1);
    expect(capped.rankShown).toBe(2);
  });

  it("leaves a time-series dataset alone (capping 'top N months' is not a chart concept here)", () => {
    const ds = { kind: "categorical", labelIsTime: true, points: [{ label: "Jan", value: 1 }, { label: "Feb", value: 99 }] };
    expect(applyRankCap(ds, { n: 1, direction: "most" })).toBe(ds);
  });

  it("passes through a non-categorical (xy) dataset untouched", () => {
    const ds = { kind: "xy", points: [{ x: 1, y: 2 }] };
    expect(applyRankCap(ds, { n: 1, direction: "most" })).toBe(ds);
  });

  it("is a no-op with no rank", () => {
    const ds = buildDataset(sheet(), "Drug", null);
    expect(applyRankCap(ds, null)).toBe(ds);
  });
});
