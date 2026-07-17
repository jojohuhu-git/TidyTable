import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { resolveChartRequest } from "./textToChart.js";
import { buildDataset, buildHistogramDataset, describeExtreme, applyRankCap } from "./aggregate.js";
import { buildChartTitle, buildCohortCaption } from "./chartTitle.js";

// P6-4: cohort-scoped charts get first-class wording. Fixture is built so the
// cystitis cohort's most common drug (cephalexin) DIFFERS from the whole
// sheet's most common drug (nitrofurantoin) — the only way to prove the
// automatic "Most common: X" callout (P3-3) is computed from the FILTERED
// rows, not silently from the whole sheet.
function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "nitrofurantoin", Duration_days: 10 },
    { PatientID: "P2", Diagnosis: "UTI", Drug: "nitrofurantoin", Duration_days: 10 },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "nitrofurantoin", Duration_days: 10 },
    { PatientID: "P4", Diagnosis: "pneumonia", Drug: "azithromycin", Duration_days: 8 },
    { PatientID: "P5", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 5 },
    { PatientID: "P6", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 7 },
    { PatientID: "P7", Diagnosis: "cystitis", Drug: "nitrofurantoin", Duration_days: 10 },
    { PatientID: "P8", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 5 },
  ]);
}

describe("P6-4 — owner's cystitis example, part (a): filtered ranked bar, top bar emphasized inside the cohort", () => {
  it("'among patients with cystitis, most common drug' resolves a cohort filter through the shared Step 3 pipeline", () => {
    const res = resolveChartRequest("among patients with cystitis, most common drug", sheet());
    expect(res.status).toBe("resolved");
    expect(res.via).toBe("step3");
    expect(res.labelCol).toBe("Drug");
    expect(res.filter).toEqual({ column: "Diagnosis", value: "cystitis" });
  });

  it("the automatic 'Most common' callout (P3-3) reflects the cystitis cohort, not the whole sheet", () => {
    const res = resolveChartRequest("among patients with cystitis, most common drug", sheet());
    let ds = buildDataset(sheet(), res.labelCol, res.valueCol, { aggMode: res.aggMode, filter: res.filter });
    if (res.rank) ds = applyRankCap(ds, res.rank);
    // Whole-sheet top is nitrofurantoin (4 of 8); the cystitis-only top is
    // cephalexin (3 of 4 cystitis rows) — proves the callout is scoped.
    expect(describeExtreme(ds)).toBe("Most common: cephalexin (75%)");
  });

  it("the chart title names the cohort", () => {
    const res = resolveChartRequest("among patients with cystitis, most common drug", sheet());
    const ds = buildDataset(sheet(), res.labelCol, res.valueCol, { aggMode: res.aggMode, filter: res.filter });
    expect(buildChartTitle(ds)).toBe("count by Drug — cystitis only");
  });

  it("the caption states n and the filter", () => {
    const res = resolveChartRequest("among patients with cystitis, most common drug", sheet());
    const ds = buildDataset(sheet(), res.labelCol, res.valueCol, { aggMode: res.aggMode, filter: res.filter });
    expect(buildCohortCaption(ds, res.filter)).toBe('Only counting rows where "Diagnosis" is "cystitis", n=4.');
  });
});

describe("P6-4 — owner's cystitis example, part (b): 'durations chosen for cystitis' produces the P6-2 histogram filtered to cystitis", () => {
  it("resolves a histogram plan with the cohort filter attached", () => {
    const res = resolveChartRequest("durations chosen for cystitis", sheet());
    expect(res.status).toBe("resolved");
    expect(res.kind).toBe("distribution");
    expect(res.shape).toBe("histogram");
    expect(res.valueCol).toBe("Duration_days");
    expect(res.filter).toEqual({ column: "Diagnosis", value: "cystitis" });
  });

  it("the histogram dataset only bins the cystitis rows (5, 7, 10, 5 — not the UTI/pneumonia rows)", () => {
    const res = resolveChartRequest("durations chosen for cystitis", sheet());
    const ds = buildHistogramDataset(sheet(), res.valueCol, { filter: res.filter });
    expect(ds.n).toBe(4);
    const byLabel = Object.fromEntries(ds.bins.map((b) => [b.label, b.count]));
    expect(byLabel["5"]).toBe(2);
    expect(byLabel["7"]).toBe(1);
    expect(byLabel["10"]).toBe(1);
  });

  it("the title and caption name the cohort", () => {
    const res = resolveChartRequest("durations chosen for cystitis", sheet());
    const ds = buildHistogramDataset(sheet(), res.valueCol, { filter: res.filter });
    expect(buildChartTitle(ds)).toBe("Distribution of Duration_days — cystitis only");
    expect(buildCohortCaption(ds, res.filter)).toBe('Only counting rows where "Diagnosis" is "cystitis", n=4.');
  });

  it("still resolves the plain (cohort-free) histogram request unchanged", () => {
    const res = resolveChartRequest("distribution of Duration_days", sheet());
    expect(res.status).toBe("resolved");
    expect(res.filter).toBeNull();
    const ds = buildHistogramDataset(sheet(), res.valueCol, { filter: res.filter });
    expect(ds.n).toBe(8);
    expect(buildChartTitle(ds)).toBe("Distribution of Duration_days");
  });

  it("never invents a filter from a cohort word that isn't a real value (honesty)", () => {
    const res = resolveChartRequest("durations chosen for nonexistentdiagnosis", sheet());
    // Whatever this resolves to (a decline, or a histogram with no filter),
    // it must never silently attach a filter naming a value the sheet doesn't have.
    if (res.status === "resolved" && res.filter) {
      expect(res.filter.value.toLowerCase()).not.toBe("nonexistentdiagnosis");
    }
  });
});

describe("P6-4 — buildChartTitle / buildCohortCaption stay unchanged when there is no filter", () => {
  it("buildChartTitle is untouched for an unfiltered categorical dataset", () => {
    const ds = buildDataset(sheet(), "Diagnosis", null);
    expect(buildChartTitle(ds)).toBe("count by Diagnosis");
  });

  it("buildCohortCaption returns an empty string with no filter", () => {
    const ds = buildDataset(sheet(), "Diagnosis", null);
    expect(buildCohortCaption(ds, null)).toBe("");
  });
});
