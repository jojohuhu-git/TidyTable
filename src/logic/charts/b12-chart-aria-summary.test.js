import { describe, it, expect } from "vitest";
import { buildChartAriaSummary } from "./chartAriaSummary.js";

describe("B12 — buildChartAriaSummary", () => {
  it("lists each point's label and value", () => {
    const dataset = { points: [{ label: "UTI", value: 3 }, { label: "Pneumonia", value: 2 }] };
    expect(buildChartAriaSummary(dataset)).toBe("UTI 3, Pneumonia 2");
  });

  it("caps the list and notes how many more there are", () => {
    const dataset = { points: Array.from({ length: 8 }, (_, i) => ({ label: `C${i}`, value: i })) };
    expect(buildChartAriaSummary(dataset, 5)).toBe("C0 0, C1 1, C2 2, C3 3, C4 4, and 3 more");
  });

  it("returns an empty string for no data", () => {
    expect(buildChartAriaSummary(null)).toBe("");
    expect(buildChartAriaSummary({ points: [] })).toBe("");
  });
});
