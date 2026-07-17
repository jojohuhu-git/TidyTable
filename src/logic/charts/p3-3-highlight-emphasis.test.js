import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildDataset, describeExtreme } from "./aggregate.js";
import { parseChartTweak, matchHighlightLabel, matchReferenceLine } from "./chartTweaks.js";
import { excelChartSteps } from "./excelChart.js";
import { buildChartAriaSummary } from "./chartAriaSummary.js";

// P3-3: request-aware emphasis on Step 9 charts — "highlight X", automatic
// largest/smallest callout, average/threshold reference line, value labels
// capped at 12 categories. Synthetic fixtures only.

function drugSheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Drug: "Cephalexin", Diagnosis: "UTI", Duration_days: 5 },
    { PatientID: "P2", Drug: "Cephalexin", Diagnosis: "UTI", Duration_days: 7 },
    { PatientID: "P3", Drug: "Cephalexin", Diagnosis: "UTI", Duration_days: 3 },
    { PatientID: "P4", Drug: "Nitrofurantoin", Diagnosis: "UTI", Duration_days: 5 },
    { PatientID: "P5", Drug: "Nitrofurantoin", Diagnosis: "Pneumonia", Duration_days: 4 },
    { PatientID: "P6", Drug: "Amoxicillin", Diagnosis: "Pneumonia", Duration_days: 6 },
  ]);
}

describe("P3-3 describeExtreme — automatic largest-category callout", () => {
  it("names the most common category with its percent share for a count chart", () => {
    const ds = buildDataset(drugSheet(), "Drug", null, { aggMode: "count" });
    expect(describeExtreme(ds)).toBe("Most common: Cephalexin (50%)");
  });

  it("names the highest average for an average chart", () => {
    const ds = buildDataset(drugSheet(), "Drug", "Duration_days", { aggMode: "average" });
    // Cephalexin avg (5+7+3)/3=5, Nitrofurantoin avg (5+4)/2=4.5, Amoxicillin 6
    expect(describeExtreme(ds)).toBe("Highest average: Amoxicillin (6)");
  });

  it("returns null when the top two categories are tied — never guesses a winner", () => {
    const tied = buildDataset(deriveSheet("S", [
      { Drug: "A" }, { Drug: "A" }, { Drug: "B" }, { Drug: "B" },
    ]), "Drug", null, { aggMode: "count" });
    expect(describeExtreme(tied)).toBeNull();
  });

  it("returns null with fewer than two categories", () => {
    const one = buildDataset(deriveSheet("S", [{ Drug: "A" }, { Drug: "A" }]), "Drug", null, { aggMode: "count" });
    expect(describeExtreme(one)).toBeNull();
  });

  it("returns null for a time-series dataset (a 'most common month' isn't a claim to make)", () => {
    const ds = buildDataset(deriveSheet("S", [
      { Month: "2024-01" }, { Month: "2024-01" }, { Month: "2024-02" },
    ]), "Month", null, { aggMode: "count" });
    expect(ds.labelIsTime).toBe(true);
    expect(describeExtreme(ds)).toBeNull();
  });
});

describe("P3-3 matchHighlightLabel — 'highlight X' resolved against the dataset's own categories", () => {
  const ds = buildDataset(drugSheet(), "Drug", null, { aggMode: "count" });

  it("resolves an exact (case-insensitive) name", () => {
    expect(matchHighlightLabel("highlight cephalexin", ds)).toEqual({ label: "Cephalexin" });
  });

  it("resolves a partial name when only one category contains it", () => {
    expect(matchHighlightLabel("highlight nitro", ds)).toEqual({ label: "Nitrofurantoin" });
  });

  it("flags ambiguity instead of guessing when more than one category matches", () => {
    const result = matchHighlightLabel("highlight a", ds);
    expect(result.ambiguous).toBeTruthy();
    expect(result.ambiguous.length).toBeGreaterThan(1);
  });

  it("returns null when nothing matches", () => {
    expect(matchHighlightLabel("highlight vancomycin", ds)).toBeNull();
  });

  it("returns null for text that isn't a highlight request", () => {
    expect(matchHighlightLabel("sort alphabetically", ds)).toBeNull();
  });
});

describe("P3-3 matchReferenceLine — average/threshold dashed line", () => {
  const ds = buildDataset(drugSheet(), "Drug", "Duration_days", { aggMode: "average" });

  it("computes the mean of the dataset's own values for 'average'", () => {
    // averages: 5, 4.5, 6 -> mean 5.1666... rounds to 5.17
    const ref = matchReferenceLine("average", ds);
    expect(ref.label).toBe("average");
    expect(ref.value).toBeCloseTo(5.17, 2);
  });

  it("uses an explicit number for 'line at 5'", () => {
    expect(matchReferenceLine("line at 5", ds)).toEqual({ value: 5, label: "5" });
  });

  it("uses an explicit number for 'threshold 6'", () => {
    expect(matchReferenceLine("threshold 6", ds)).toEqual({ value: 6, label: "6" });
  });

  it("returns null for unrelated text", () => {
    expect(matchReferenceLine("sort alphabetically", ds)).toBeNull();
  });
});

describe("P3-3 parseChartTweak — new highlight/reference verbs, existing verbs unaffected", () => {
  const ds = buildDataset(drugSheet(), "Drug", null, { aggMode: "count" });

  it("'highlight cephalexin' -> highlight tweak", () => {
    expect(parseChartTweak("highlight cephalexin", ds)).toEqual({ kind: "highlight", label: "Cephalexin" });
  });

  it("'highlight vancomycin' (no such category) -> honest unmatched, not a silent no-op", () => {
    expect(parseChartTweak("highlight vancomycin", ds)).toEqual({ kind: "highlight-unmatched", text: "highlight vancomycin" });
  });

  it("'highlight a' (ambiguous) -> honest ambiguity, not a guess", () => {
    const r = parseChartTweak("highlight a", ds);
    expect(r.kind).toBe("highlight-ambiguous");
    expect(r.options.length).toBeGreaterThan(1);
  });

  it("'average' -> reference tweak", () => {
    const r = parseChartTweak("average", ds);
    expect(r.kind).toBe("reference");
    expect(r.label).toBe("average");
  });

  it("existing 'only top 5' still parses as topn (regression)", () => {
    expect(parseChartTweak("only top 5", ds)).toEqual({ kind: "topn", n: 5 });
  });

  it("existing 'sort alphabetically' still parses as sort (regression)", () => {
    expect(parseChartTweak("sort alphabetically", ds)).toEqual({ kind: "sort", mode: "alpha" });
  });

  it("works with no dataset passed (backward compatible call signature)", () => {
    expect(parseChartTweak("only top 5")).toEqual({ kind: "topn", n: 5 });
  });
});

describe("P3-3 excelChartSteps — emphasis survives into the Excel recipe text", () => {
  const ds = buildDataset(drugSheet(), "Drug", null, { aggMode: "count" });

  it("adds a 'Match the emphasis' step naming the highlight, reference line, and callout", () => {
    const steps = excelChartSteps("bar", ds, {}, {
      highlightLabel: "Cephalexin",
      referenceLine: { value: 5, label: "average" },
      extremeCallout: "Most common: Cephalexin (50%)",
    });
    const step = steps.find((s) => s.title === "Match the emphasis");
    expect(step).toBeTruthy();
    expect(step.instruction).toContain("Cephalexin");
    expect(step.instruction).toContain("average");
    expect(step.instruction).toContain("Most common: Cephalexin (50%)");
  });

  it("adds no emphasis step when nothing is set (regression — default behavior unchanged)", () => {
    const steps = excelChartSteps("bar", ds, {});
    expect(steps.find((s) => s.title === "Match the emphasis")).toBeUndefined();
  });
});

describe("P3-3 buildChartAriaSummary — mentions highlight and reference line when present", () => {
  it("mentions the highlighted category", () => {
    const dataset = { points: [{ label: "UTI", value: 3 }, { label: "Pneumonia", value: 2 }] };
    const s = buildChartAriaSummary(dataset, 5, { highlightLabel: "UTI" });
    expect(s).toContain("Highlighted: UTI");
    expect(s).toContain("UTI 3, Pneumonia 2");
  });

  it("mentions the reference line", () => {
    const dataset = { points: [{ label: "UTI", value: 3 }, { label: "Pneumonia", value: 2 }] };
    const s = buildChartAriaSummary(dataset, 5, { referenceLine: { value: 5.17, label: "average" } });
    expect(s).toContain("Reference line at average (5.17)");
  });

  it("regression: unchanged with no opts", () => {
    const dataset = { points: [{ label: "UTI", value: 3 }, { label: "Pneumonia", value: 2 }] };
    expect(buildChartAriaSummary(dataset)).toBe("UTI 3, Pneumonia 2");
  });
});
