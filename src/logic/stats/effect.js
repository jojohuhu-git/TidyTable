// Effect sizes with confidence intervals (build prompt §9): a p-value alone is a
// half-answer, so every test reports how big the difference is and how uncertain.
// Odds ratio and risk ratio for 2×2 tables, a Wilson interval for a single
// proportion, and the interval for a difference in means from a t-test.

import { zForConfidence, tTwoSidedP } from "./distributions.js";

// Wilson score interval for a proportion — behaves well even for small n or
// proportions near 0 or 1, unlike the textbook (Wald) interval.
export function ciProportion(x, n, level = 0.95) {
  const z = zForConfidence(level);
  const p = x / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { proportion: p, lo: Math.max(0, center - margin), hi: Math.min(1, center + margin), level };
}

// Odds ratio for a 2×2 table [[a,b],[c,d]] with a large-sample (Woolf) log
// interval. A zero in any cell triggers the Haldane–Anscombe 0.5 correction so
// the interval is still defined.
export function oddsRatio(a, b, c, d, level = 0.95) {
  let aa = a, bb = b, cc = c, dd = d;
  const corrected = [a, b, c, d].some((v) => v === 0);
  if (corrected) { aa += 0.5; bb += 0.5; cc += 0.5; dd += 0.5; }
  const or = (aa * dd) / (bb * cc);
  const seLog = Math.sqrt(1 / aa + 1 / bb + 1 / cc + 1 / dd);
  const z = zForConfidence(level);
  const logOr = Math.log(or);
  return {
    measure: "odds ratio", value: or, corrected, level,
    lo: Math.exp(logOr - z * seLog), hi: Math.exp(logOr + z * seLog),
  };
}

// Risk ratio (relative risk) for a 2×2 table [[a,b],[c,d]] where rows are the two
// groups and column 1 is the outcome of interest. Log interval, same zero-cell
// correction.
export function riskRatio(a, b, c, d, level = 0.95) {
  let aa = a, bb = b, cc = c, dd = d;
  const corrected = [a, b, c, d].some((v) => v === 0);
  if (corrected) { aa += 0.5; bb += 0.5; cc += 0.5; dd += 0.5; }
  const risk1 = aa / (aa + bb);
  const risk2 = cc / (cc + dd);
  const rr = risk1 / risk2;
  const seLog = Math.sqrt(1 / aa - 1 / (aa + bb) + 1 / cc - 1 / (cc + dd));
  const z = zForConfidence(level);
  const logRr = Math.log(rr);
  return {
    measure: "risk ratio", value: rr, risk1, risk2, corrected, level,
    lo: Math.exp(logRr - z * seLog), hi: Math.exp(logRr + z * seLog),
  };
}

// Confidence interval for the difference in means from a Welch t-test result.
export function ciMeanDiff(tt, level = 0.95) {
  // Use the t multiplier at the Welch df (invert the two-sided t p-value).
  const tMult = tMultiplier(tt.df, level);
  return {
    measure: "difference in means", value: tt.diff, level,
    lo: tt.diff - tMult * tt.se, hi: tt.diff + tMult * tt.se,
  };
}

// The two-sided t critical value for df at the given level, by bisection on the
// t p-value.
function tMultiplier(df, level) {
  const alpha = 1 - level;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
