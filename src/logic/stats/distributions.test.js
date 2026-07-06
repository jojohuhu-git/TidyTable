import { describe, it, expect } from "vitest";
import {
  chiSquareP, tTwoSidedP, normalCDF, normalTwoSidedP, zForConfidence, betaI, gammaQ,
} from "./distributions.js";

const near = (a, b, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("chi-square upper-tail p", () => {
  it("matches the 0.05 critical value at df=1 (3.841)", () => near(chiSquareP(3.841, 1), 0.05));
  it("matches df=1 at 6.635 (p≈0.01)", () => near(chiSquareP(6.635, 1), 0.01));
  it("matches df=2 at 5.991 (p≈0.05)", () => near(chiSquareP(5.991, 2), 0.05));
  it("is ~0.95 for a tiny statistic", () => near(chiSquareP(0.00393, 1), 0.95));
});

describe("t two-sided p", () => {
  it("t=2.228, df=10 → p≈0.05", () => near(tTwoSidedP(2.228, 10), 0.05));
  it("t=2.086, df=20 → p≈0.05", () => near(tTwoSidedP(2.086, 20), 0.05));
  it("t=0 → p=1", () => near(tTwoSidedP(0, 5), 1));
});

describe("normal", () => {
  it("CDF(1.96)≈0.975", () => near(normalCDF(1.96), 0.975));
  it("two-sided p at z=1.96 ≈ 0.05", () => near(normalTwoSidedP(1.96), 0.05));
  it("z for 95% ≈ 1.96", () => near(zForConfidence(0.95), 1.96, 1e-2));
  it("z for 99% ≈ 2.576", () => near(zForConfidence(0.99), 2.576, 1e-2));
});

describe("incomplete beta and gamma sanity", () => {
  it("betaI symmetric midpoint", () => near(betaI(3, 3, 0.5), 0.5));
  it("gammaQ(1, x) = e^-x", () => near(gammaQ(1, 2), Math.exp(-2)));
});
