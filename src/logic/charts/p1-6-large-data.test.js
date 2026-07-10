import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildDataset, maxOf } from "./aggregate.js";
import { recommendChart } from "./advisor.js";

// P1-6: a spread of a large array (Math.max(...arr)) throws RangeError:
// Maximum call stack size exceeded — verified against the real bug before
// the fix (a 300k-element array reliably threw). maxOf must not.
describe("P1-6 — maxOf handles very large arrays without a stack overflow", () => {
  it("does not throw on 300,000 values and returns the true max", () => {
    const values = Array.from({ length: 300000 }, (_, i) => i);
    expect(() => maxOf(values)).not.toThrow();
    expect(maxOf(values)).toBe(299999);
  });
  it("returns the fallback for an empty array", () => {
    expect(maxOf([], 1)).toBe(1);
    expect(maxOf([])).toBe(0);
  });
});

describe("P1-6 — scatter datasets are sampled down past a point cap", () => {
  it("a huge scatter dataset builds without throwing and is capped", () => {
    const rows = Array.from({ length: 50000 }, (_, i) => ({ Age: i % 100, LOS: (i * 7) % 50 }));
    const sheet = deriveSheet("D", rows);
    let ds;
    expect(() => { ds = buildDataset(sheet, "Age", "LOS"); }).not.toThrow();
    expect(ds.points.length).toBeLessThan(rows.length);
    expect(ds.sampled).toBe(true);
    expect(ds.totalPoints).toBe(rows.length);
  });

  it("a small scatter dataset is not sampled", () => {
    const rows = [{ Age: 60, LOS: 4 }, { Age: 70, LOS: 6 }];
    const ds = buildDataset(deriveSheet("D", rows), "Age", "LOS");
    expect(ds.sampled).toBe(false);
    expect(ds.points).toHaveLength(2);
  });
});

describe("P1-6 / W4 — the advisor draws many categories as horizontal bars, never refusing", () => {
  // W4 (owner's decision): the old P1-6 "refuse past ~30 categories" behavior
  // was replaced — a large category count now draws a horizontal all-rows bar
  // chart (sorted largest-first, canvas grows taller), never type "none".
  it("recommends a horizontal bar layout past many distinct categories, counting them honestly", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ PatientID: `P${i}` }));
    const ds = buildDataset(deriveSheet("D", rows), "PatientID", null);
    const rec = recommendChart(ds);
    expect(rec.type).toBe("bar");
    expect(rec.layout).toBe("horizontal");
    expect(rec.reason).toMatch(/200 categories/);
    expect(rec.offerGroupOther).toBe(true);
  });

  it("still recommends bars for a normal-sized category count", () => {
    const rows = [{ Ward: "A" }, { Ward: "B" }, { Ward: "C" }];
    const ds = buildDataset(deriveSheet("D", rows), "Ward", null);
    expect(recommendChart(ds).type).toBe("bar");
  });

  it("a long time series is not blocked by the category cap (line handles many points)", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      Month: `2020-${String((i % 12) + 1).padStart(2, "0")}`,
      N: i,
    }));
    const ds = buildDataset(deriveSheet("D", rows), "Month", "N");
    expect(ds.labelIsTime).toBe(true);
    expect(recommendChart(ds).type).toBe("line");
  });
});
