// Contingency-table tests (build prompt §9). Chi-square for 2×2 and R×C, Fisher's
// exact for 2×2. Every result carries the pieces the show-the-work contract needs:
// the table, the expected counts, the statistic, df and p. The test-choice rule
// (switch to Fisher when an expected count is below 5) lives in runStats.js.

import { chiSquareP, logGamma } from "./distributions.js";

// rows: array of arrays (the observed counts). Returns totals and expected counts.
function margins(rows) {
  const nRows = rows.length;
  const nCols = rows[0].length;
  const rowTot = rows.map((r) => r.reduce((a, b) => a + b, 0));
  const colTot = Array.from({ length: nCols }, (_, j) => rows.reduce((a, r) => a + r[j], 0));
  const grand = rowTot.reduce((a, b) => a + b, 0);
  const expected = rows.map((_, i) => colTot.map((ct) => (rowTot[i] * ct) / grand));
  return { rowTot, colTot, grand, expected, nRows, nCols };
}

// Pearson chi-square for any R×C table of counts.
export function chiSquare(rows) {
  const { rowTot, colTot, grand, expected, nRows, nCols } = margins(rows);
  let stat = 0;
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      const e = expected[i][j];
      if (e > 0) stat += ((rows[i][j] - e) ** 2) / e;
    }
  }
  const df = (nRows - 1) * (nCols - 1);
  const minExpected = Math.min(...expected.flat());
  return { test: "chi-square", table: rows, expected, rowTot, colTot, grand, statistic: stat, df, p: chiSquareP(stat, df), minExpected };
}

// ln of n!
function logFact(n) {
  return logGamma(n + 1);
}

// Probability of one 2×2 table under the hypergeometric (Fisher) model, fixed
// margins.
function hypergeomP(a, b, c, d) {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const c2 = b + d;
  const n = r1 + r2;
  const logP =
    logFact(r1) + logFact(r2) + logFact(c1) + logFact(c2) -
    logFact(n) - logFact(a) - logFact(b) - logFact(c) - logFact(d);
  return Math.exp(logP);
}

// Fisher's exact test for a 2×2 table. Two-sided p sums the probabilities of all
// tables (with the same margins) no more likely than the observed one.
export function fisherExact(a, b, c, d) {
  const r1 = a + b;
  const c1 = a + c;
  const n = a + b + c + d;
  const pObs = hypergeomP(a, b, c, d);
  const aMin = Math.max(0, c1 - r2Of(n, r1));
  const aMax = Math.min(r1, c1);
  let pTwoSided = 0;
  let pLess = 0;
  let pGreater = 0;
  for (let x = aMin; x <= aMax; x++) {
    const bx = r1 - x;
    const cx = c1 - x;
    const dx = n - x - bx - cx;
    if (bx < 0 || cx < 0 || dx < 0) continue;
    const p = hypergeomP(x, bx, cx, dx);
    if (p <= pObs * (1 + 1e-7)) pTwoSided += p;
    if (x <= a) pLess += p;
    if (x >= a) pGreater += p;
  }
  return { test: "fisher", table: [[a, b], [c, d]], pObserved: pObs, p: Math.min(1, pTwoSided), pLess: Math.min(1, pLess), pGreater: Math.min(1, pGreater) };
}

function r2Of(n, r1) {
  return n - r1;
}
