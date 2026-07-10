// Two-sample t-test (build prompt §9). Welch's version (does not assume the two
// groups have equal spread) is the safer default and what we use. Returns the
// group means, the difference, the t statistic, Welch degrees of freedom and the
// two-sided p — plus enough to show the work.

import { tTwoSidedP } from "./distributions.js";

const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
const variance = (arr, m) => arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);

export function tTestWelch(a, b) {
  const nA = a.length;
  const nB = b.length;
  const mA = mean(a);
  const mB = mean(b);
  const vA = variance(a, mA);
  const vB = variance(b, mB);
  const se = Math.sqrt(vA / nA + vB / nB);
  const t = (mA - mB) / se;
  const df =
    (vA / nA + vB / nB) ** 2 /
    ((vA / nA) ** 2 / (nA - 1) + (vB / nB) ** 2 / (nB - 1));
  return {
    test: "t-test",
    meanA: mA, meanB: mB, sdA: Math.sqrt(vA), sdB: Math.sqrt(vB),
    nA, nB, diff: mA - mB, se, statistic: t, df, p: tTwoSidedP(t, df),
  };
}
