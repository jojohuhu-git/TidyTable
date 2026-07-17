import { describe, it, expect } from "vitest";
import { resolveChartRequest } from "./textToChart.js";
import { buildHistogramDataset, buildBoxDotDataset, computeHistogramBins } from "./aggregate.js";
import { recommendChart } from "./advisor.js";
import { buildDataset } from "./aggregate.js";
import { deriveSheet } from "../workbook.js";

// P6-2 (fix-2026-07-11-steps-2-3-9-plain-english.md): distribution charts
// for numeric columns — a histogram (one number, no grouping) and a box+dot
// plot (a number's spread within each group), following the exact pattern
// P6-1 set for the crosstab.

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, Ward: "ICU" },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "azithromycin", Duration_days: 7, Ward: "General" },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 5, Ward: "ICU" },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, Ward: "General" },
    { PatientID: "P5", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 6, Ward: "ICU" },
    { PatientID: "P6", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 8, Ward: "General" },
    { PatientID: "P7", Diagnosis: "cystitis", Drug: "nitrofurantoin", Duration_days: 5, Ward: "ICU" },
    { PatientID: "P8", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 4, Ward: "General" },
    { PatientID: "P9", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, Ward: "ICU" },
    { PatientID: "P10", Diagnosis: "pneumonia", Drug: "azithromycin", Duration_days: 9, Ward: "General" },
    { PatientID: "P11", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 7, Ward: "ICU" },
    { PatientID: "P12", Diagnosis: "cystitis", Drug: "nitrofurantoin", Duration_days: 4, Ward: "General" },
  ]);
}

describe("P6-2 — free-text resolution of a plain histogram request", () => {
  it('"distribution of Duration_days" resolves to a histogram', () => {
    const res = resolveChartRequest("distribution of Duration_days", sheet());
    expect(res.status).toBe("resolved");
    expect(res.kind).toBe("distribution");
    expect(res.shape).toBe("histogram");
    expect(res.valueCol).toBe("Duration_days");
    expect(res.confidence).toBe("exact");
  });

  it('the spec\'s own example, "durations chosen", resolves to the same histogram (plural + fold match)', () => {
    const res = resolveChartRequest("durations chosen", sheet());
    expect(res.status).toBe("resolved");
    expect(res.kind).toBe("distribution");
    expect(res.shape).toBe("histogram");
    expect(res.valueCol).toBe("Duration_days");
  });

  it('"histogram of Duration_days" and "spread of Duration_days" also resolve', () => {
    expect(resolveChartRequest("histogram of Duration_days", sheet()).valueCol).toBe("Duration_days");
    expect(resolveChartRequest("spread of Duration_days", sheet()).valueCol).toBe("Duration_days");
  });

  it('"spread of Duration_days by Ward" is a by-group ask, NOT a plain histogram — falls through to the average-by-group path instead of silently dropping "Ward"', () => {
    const res = resolveChartRequest("spread of Duration_days by Ward", sheet());
    expect(res.kind).not.toBe("distribution");
    // The local parser reads this as an average-by-group request (no
    // recognized aggregation word, numeric leftover -> average, per the
    // existing honesty-bug-2 flip) rather than silently losing "Ward".
    expect(res.labelCol).toBe("Ward");
    expect(res.valueCol).toBe("Duration_days");
  });

  it("a column name that isn't numeric never resolves as a histogram", () => {
    const res = resolveChartRequest("distribution of Diagnosis", sheet());
    expect(res.kind).not.toBe("distribution");
  });
});

describe("P6-2 — computeHistogramBins (integer-friendly binning)", () => {
  it("small whole-number range: one bar per integer, never a fractional range", () => {
    const { bins, binRule, unitBins } = computeHistogramBins([5, 7, 10, 3, 6, 8, 5, 4, 3, 9, 7, 4]);
    expect(unitBins).toBe(true);
    expect(binRule).toMatch(/whole number/i);
    const byLabel = Object.fromEntries(bins.map((b) => [b.label, b.count]));
    expect(byLabel["5"]).toBe(2);
    expect(byLabel["7"]).toBe(2);
    expect(byLabel["10"]).toBe(1);
    expect(byLabel["3"]).toBe(2);
    // every label is a bare integer, never "4.5–6.5"
    expect(bins.every((b) => /^\d+$/.test(b.label))).toBe(true);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(12);
  });

  it("a wide or non-integer range uses nice wider bins with a range label, not one bar per value", () => {
    const values = Array.from({ length: 40 }, (_, i) => i * 3.7); // range ~144, non-integer
    const { bins, binRule, unitBins } = computeHistogramBins(values);
    expect(unitBins).toBe(false);
    expect(binRule).toMatch(/range of/i);
    expect(bins.length).toBeLessThanOrEqual(20); // "nice" round-number bins target ~10, never one-per-value (40 values here)
    expect(bins.every((b) => b.label.includes("–"))).toBe(true);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(40);
  });

  it("every value lands in exactly one bin — no double-count, no drop, including the max value at the top edge", () => {
    const values = [1, 2, 3, 100];
    const { bins } = computeHistogramBins(values);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(4);
  });

  it("a single repeated value still produces one readable bar, not a crash", () => {
    const { bins } = computeHistogramBins([5, 5, 5, 5]);
    expect(bins.length).toBe(1);
    expect(bins[0].count).toBe(4);
  });
});

describe("P6-2 — buildHistogramDataset", () => {
  it("bins every readable value in the column and reports the bin rule", () => {
    const d = buildHistogramDataset(sheet(), "Duration_days");
    expect(d.kind).toBe("distribution");
    expect(d.shape).toBe("histogram");
    expect(d.valueName).toBe("Duration_days");
    expect(d.n).toBe(12);
    expect(d.bins.reduce((s, b) => s + b.count, 0)).toBe(12);
    expect(d.binRule).toBeTruthy();
  });

  it("an unreadable cell is left out and counted honestly, never treated as zero", () => {
    const rows = [
      { PatientID: "P1", Duration_days: 5 },
      { PatientID: "P2", Duration_days: "not available" },
      { PatientID: "P3", Duration_days: 7 },
    ];
    const d = buildHistogramDataset(deriveSheet("E", rows), "Duration_days");
    expect(d.n).toBe(2);
    expect(d.unreadableCount).toBe(1);
    expect(d.bins.reduce((s, b) => s + b.count, 0)).toBe(2);
  });

  it("respects a single-value filter, same as every other dataset builder here", () => {
    const d = buildHistogramDataset(sheet(), "Duration_days", { filter: { column: "Ward", value: "ICU" } });
    expect(d.filter).toEqual({ column: "Ward", value: "ICU" });
    expect(d.n).toBe(6); // 6 ICU rows in the fixture
  });
});

describe("P6-2 — buildBoxDotDataset (reuses computeNumericStats — one brain)", () => {
  it("computes real quartiles/median per group, sorted largest-median-first", () => {
    const d = buildBoxDotDataset(sheet(), "Diagnosis", "Duration_days");
    expect(d.kind).toBe("distribution");
    expect(d.shape).toBe("boxdot");
    expect(d.labelName).toBe("Diagnosis");
    expect(d.valueName).toBe("Duration_days");
    // UTI: 10, 5, 6, 4, 7 -> sorted 4,5,6,7,10 -> median 6
    const uti = d.groups.find((g) => g.label === "UTI");
    expect(uti.stats.median).toBe(6);
    expect(uti.n).toBe(5);
    // groups are sorted by descending median
    const medians = d.groups.map((g) => g.stats.median);
    expect(medians).toEqual([...medians].sort((a, b) => b - a));
  });

  it("keeps raw values as jittered dots only when n per group is small enough to trust", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ Diagnosis: "UTI", Duration_days: i % 15 }));
    const d = buildBoxDotDataset(deriveSheet("E", rows), "Diagnosis", "Duration_days");
    const uti = d.groups.find((g) => g.label === "UTI");
    expect(uti.n).toBe(60);
    expect(uti.values).toBeNull(); // past the cap — box only, no fake dot cloud
  });

  it("a group with zero readable numbers is left out and named, never a zero-width box", () => {
    const rows = [
      { Diagnosis: "UTI", Duration_days: 5 },
      { Diagnosis: "sepsis", Duration_days: "unknown" },
      { Diagnosis: "sepsis", Duration_days: "n/a" },
    ];
    const d = buildBoxDotDataset(deriveSheet("E", rows), "Diagnosis", "Duration_days");
    expect(d.groups.find((g) => g.label === "sepsis")).toBeUndefined();
    expect(d.noDataGroups).toEqual(["sepsis"]);
  });

  it("respects a single-value filter", () => {
    const d = buildBoxDotDataset(sheet(), "Diagnosis", "Duration_days", { filter: { column: "Ward", value: "ICU" } });
    expect(d.filter).toEqual({ column: "Ward", value: "ICU" });
    const total = d.groups.reduce((s, g) => s + g.n, 0);
    expect(total).toBe(6);
  });
});

describe("P6-2 — advisor recommendation and reasons", () => {
  it("recommends a histogram with the bin rule stated in the reason", () => {
    const d = buildHistogramDataset(sheet(), "Duration_days");
    const rec = recommendChart(d);
    expect(rec.type).toBe("histogram");
    expect(rec.reason).toMatch(/Duration_days/);
    expect(rec.alternatives).toEqual([]);
  });

  it("recommends a box and dot plot naming the spread, offering the average bar back", () => {
    const d = buildBoxDotDataset(sheet(), "Diagnosis", "Duration_days");
    const rec = recommendChart(d);
    expect(rec.type).toBe("boxdot");
    expect(rec.reason).toMatch(/spread/i);
    expect(rec.alternatives).toEqual([{ type: "bar", reason: expect.stringMatching(/average bar/i) }]);
  });

  it("cross-offer: an average-by-group bar chart offers box+dot as an alternative", () => {
    const d = buildDataset(sheet(), "Diagnosis", "Duration_days", { aggMode: "average" });
    const rec = recommendChart(d);
    expect(rec.type).toBe("bar");
    expect(rec.alternatives.some((a) => a.type === "boxdot")).toBe(true);
    expect(rec.alternatives.find((a) => a.type === "boxdot").reason).toMatch(/spread/i);
  });

  it("a plain COUNT bar chart does NOT offer box+dot (spreading a count isn't a meaningful ask)", () => {
    const d = buildDataset(sheet(), "Diagnosis", null, { aggMode: "count" });
    const rec = recommendChart(d);
    expect(rec.alternatives.some((a) => a.type === "boxdot")).toBe(false);
  });
});
