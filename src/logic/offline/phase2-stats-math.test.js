import { describe, it, expect } from "vitest";
import { computeNumericStats, aggregateOne } from "./cohort.js";

// Phase 2 (2026-07-10): the math cohort.js uses for median/quartiles/SD/
// min/max/range. Quartiles use the same "linear interpolation between closest
// ranks" method Excel's QUARTILE.INC uses (== R/numpy's default "type 7"
// quantile), so the app's number and the Excel step's number always agree.

describe("computeNumericStats", () => {
  it("returns all-null for an empty array (never a silent 0)", () => {
    expect(computeNumericStats([])).toEqual({
      n: 0, mean: null, sd: null, median: null, q1: null, q3: null, iqr: null, min: null, max: null, range: null,
    });
  });

  it("a single number: mean/median/min/max/range are that value, sd is null (needs 2+ points)", () => {
    const s = computeNumericStats([7]);
    expect(s).toMatchObject({ n: 1, mean: 7, median: 7, min: 7, max: 7, range: 0, sd: null });
  });

  it("matches Excel MEDIAN/QUARTILE.INC/STDEV.S for an odd-count sample (verified against Excel's documented algorithm)", () => {
    // 3, 6, 7, 8, 8, 10, 13 (n=7, sorted already)
    const nums = [3, 6, 7, 8, 8, 10, 13];
    const s = computeNumericStats(nums);
    expect(s.median).toBe(8); // QUARTILE.INC(range,2) / MEDIAN — the 4th of 7
    expect(s.q1).toBe(6.5); // QUARTILE.INC(range,1): interpolated between 6 and 7
    expect(s.q3).toBe(9); // QUARTILE.INC(range,3): interpolated between 8 and 10
    expect(s.iqr).toBe(2.5);
    expect(s.min).toBe(3);
    expect(s.max).toBe(13);
    expect(s.range).toBe(10);
    // mean = 55/7 = 7.857142... -> rounded to 2 dp
    expect(s.mean).toBe(7.86);
    // sample SD (n-1 denominator) of this set is ~3.13
    expect(s.sd).toBeCloseTo(3.13, 1);
  });

  it("matches Excel's interpolated median for an even count", () => {
    // 1, 2, 3, 4 -> median interpolates between 2 and 3 = 2.5
    const s = computeNumericStats([1, 2, 3, 4]);
    expect(s.median).toBe(2.5);
    expect(s.q1).toBe(1.75);
    expect(s.q3).toBe(3.25);
  });

  it("order of the input doesn't matter — the function sorts internally", () => {
    const a = computeNumericStats([10, 6, 3, 8, 8, 13, 7]);
    const b = computeNumericStats([3, 6, 7, 8, 8, 10, 13]);
    expect(a).toEqual(b);
  });
});

describe("aggregateOne — Phase 2 new intents", () => {
  const rows = [
    { Duration_days: 10 }, { Duration_days: 6 }, { Duration_days: "N/A" }, { Duration_days: 5 }, { Duration_days: 3 },
  ];

  it("median skips unreadable rows, same as average already does", () => {
    const res = aggregateOne(rows, "Duration_days", "median");
    // readable: 10, 6, 5, 3 -> sorted 3,5,6,10 -> median interpolates 5.5
    expect(res.value).toBe(5.5);
    expect(res.n).toBe(4);
    expect(res.skipped).toBe(1);
  });

  it("stdev, min, max, range all read from the same stats bundle", () => {
    const res = aggregateOne(rows, "Duration_days", "stdev");
    expect(res.n).toBe(4);
    expect(res.value).toBeCloseTo(res.sd, 5);
    const minRes = aggregateOne(rows, "Duration_days", "min");
    expect(minRes.value).toBe(3);
    const maxRes = aggregateOne(rows, "Duration_days", "max");
    expect(maxRes.value).toBe(10);
    const rangeRes = aggregateOne(rows, "Duration_days", "range");
    expect(rangeRes.value).toBe(7);
  });

  it("every intent's return carries the full stats bundle (mean/sd/median/q1/q3/iqr/min/max/range), not just its own value", () => {
    const res = aggregateOne(rows, "Duration_days", "average");
    expect(res).toMatchObject({ mean: 6, median: 5.5, min: 3, max: 10 });
    expect(res.q1).not.toBeUndefined();
    expect(res.q3).not.toBeUndefined();
  });

  it("a group with zero readable numbers reports null everywhere, never a silent 0", () => {
    const res = aggregateOne([{ Duration_days: "N/A" }, { Duration_days: "" }], "Duration_days", "average");
    expect(res.n).toBe(0);
    expect(res.value).toBeNull();
    expect(res.sd).toBeNull();
    expect(res.median).toBeNull();
  });

  it("sum stays the exact unrounded running total, unchanged from A3 Level 2 behavior", () => {
    const res = aggregateOne(rows, "Duration_days", "sum");
    expect(res.value).toBe(24);
  });
});
