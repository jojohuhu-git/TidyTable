import { describe, it, expect } from "vitest";
import { chiSquare, fisherExact } from "./contingency.js";
import { tTestWelch } from "./ttest.js";
import { ciProportion, oddsRatio, riskRatio, ciMeanDiff } from "./effect.js";

const near = (a, b, tol = 0.02) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("chi-square", () => {
  const res = chiSquare([[12, 8], [5, 15]]);
  it("computes the statistic (~5.01)", () => near(res.statistic, 5.01, 0.05));
  it("df=1 for a 2x2", () => expect(res.df).toBe(1));
  it("p ≈ 0.025", () => near(res.p, 0.0252, 0.005));
  it("reports expected counts and the smallest one", () => {
    expect(res.expected[0][0]).toBeCloseTo(8.5, 5);
    near(res.minExpected, 8.5, 0.001);
  });
});

describe("fisher exact", () => {
  it("tea-tasting [[3,1],[1,3]] two-sided p ≈ 0.486", () => {
    near(fisherExact(3, 1, 1, 3).p, 0.4857, 0.01);
  });
  it("[[1,9],[11,3]] two-sided p ≈ 0.00276", () => {
    near(fisherExact(1, 9, 11, 3).p, 0.00276, 0.001);
  });
});

describe("welch t-test", () => {
  const res = tTestWelch([1, 2, 3, 4, 5], [3, 4, 5, 6, 7]);
  it("difference in means is -2", () => near(res.diff, -2, 1e-9));
  it("t = -2 with df ≈ 8", () => {
    near(res.statistic, -2, 1e-9);
    near(res.df, 8, 1e-6);
  });
  it("p ≈ 0.081", () => near(res.p, 0.0809, 0.005));
});

describe("effect sizes with CIs", () => {
  it("Wilson proportion 12/20 ≈ 0.60 (0.39, 0.78)", () => {
    const ci = ciProportion(12, 20);
    near(ci.proportion, 0.6, 1e-9);
    near(ci.lo, 0.386, 0.01);
    near(ci.hi, 0.781, 0.01);
  });
  it("odds ratio [[12,8],[5,15]] = 4.5 (1.16, 17.4)", () => {
    const or = oddsRatio(12, 8, 5, 15);
    near(or.value, 4.5, 1e-6);
    near(or.lo, 1.16, 0.05);
    near(or.hi, 17.4, 0.3);
  });
  it("risk ratio [[12,8],[5,15]] = 2.4 (1.04, 5.55)", () => {
    const rr = riskRatio(12, 8, 5, 15);
    near(rr.value, 2.4, 1e-6);
    near(rr.lo, 1.04, 0.05);
    near(rr.hi, 5.55, 0.2);
  });
  it("applies a zero-cell correction rather than dividing by zero", () => {
    const or = oddsRatio(0, 10, 8, 6);
    expect(or.corrected).toBe(true);
    expect(Number.isFinite(or.value)).toBe(true);
  });
  it("mean-difference CI brackets the difference", () => {
    const tt = tTestWelch([1, 2, 3, 4, 5], [3, 4, 5, 6, 7]);
    const ci = ciMeanDiff(tt);
    expect(ci.lo).toBeLessThan(tt.diff);
    expect(ci.hi).toBeGreaterThan(tt.diff);
  });
});
