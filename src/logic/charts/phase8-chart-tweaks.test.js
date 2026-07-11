import { describe, it, expect } from "vitest";
import { parseChartTweak, sortDataset } from "./chartTweaks.js";

// Phase 8.5 — deterministic post-draw word tweaks.

describe("parseChartTweak recognizes the fixed verb set", () => {
  it("caps: 'only top 5', 'top 3', 'show 10'", () => {
    expect(parseChartTweak("only top 5")).toEqual({ kind: "topn", n: 5 });
    expect(parseChartTweak("top 3")).toEqual({ kind: "topn", n: 3 });
    expect(parseChartTweak("just the top 8")).toEqual({ kind: "topn", n: 8 });
  });

  it("sorts: alphabetical vs largest-first", () => {
    expect(parseChartTweak("sort alphabetically")).toEqual({ kind: "sort", mode: "alpha" });
    expect(parseChartTweak("a to z")).toEqual({ kind: "sort", mode: "alpha" });
    expect(parseChartTweak("largest first")).toEqual({ kind: "sort", mode: "value" });
    expect(parseChartTweak("sort by size")).toEqual({ kind: "sort", mode: "value" });
  });

  it("recognizes percent, blanks and flip", () => {
    expect(parseChartTweak("show as percentages").kind).toBe("percent");
    expect(parseChartTweak("hide the blanks").kind).toBe("blanks");
    expect(parseChartTweak("flip the axes").kind).toBe("flip");
  });

  it("returns unknown for an unrecognized phrase (never a silent no-op)", () => {
    expect(parseChartTweak("make it beautiful").kind).toBe("unknown");
    expect(parseChartTweak("").kind).toBe("unknown");
  });
});

describe("sortDataset reorders without touching the numbers", () => {
  const ds = {
    kind: "categorical", labelIsTime: false,
    points: [{ label: "North", value: 5 }, { label: "South", value: 3 }, { label: "East", value: 2 }],
  };

  it("sorts A→Z by label", () => {
    expect(sortDataset(ds, "alpha").points.map((p) => p.label)).toEqual(["East", "North", "South"]);
  });

  it("sorts largest value first", () => {
    expect(sortDataset(ds, "value").points.map((p) => p.value)).toEqual([5, 3, 2]);
  });

  it("leaves a time series alone (chronology must not be reordered)", () => {
    const time = { kind: "categorical", labelIsTime: true, points: [{ label: "Jan", value: 1 }, { label: "Feb", value: 9 }] };
    expect(sortDataset(time, "alpha")).toBe(time);
  });

  it("passes an xy dataset through untouched", () => {
    const xy = { kind: "xy", points: [{ x: 1, y: 2 }] };
    expect(sortDataset(xy, "alpha")).toBe(xy);
  });
});
