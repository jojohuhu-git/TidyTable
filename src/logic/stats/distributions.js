// The special functions the statistics tests need (build prompt §9). These are
// the standard, well-known numerical routines (Lanczos log-gamma, the series and
// continued-fraction forms of the incomplete gamma and beta functions). They run
// in the browser with no library, and are unit-tested against published values
// so the p-values can be trusted.

// Lanczos approximation to ln(Gamma(x)), good to ~1e-10 for x > 0.
export function logGamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula for x < 0.5.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Regularized lower incomplete gamma P(a, x) via series (x < a+1) or its
// complement (x >= a+1). Returns a value in [0, 1].
export function gammaP(a, x) {
  if (x <= 0 || a <= 0) return 0;
  if (x < a + 1) {
    // Series expansion.
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // Continued fraction for Q, then P = 1 - Q.
  return 1 - gammaQ(a, x);
}

// Regularized upper incomplete gamma Q(a, x) = 1 - P(a, x).
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (a <= 0) return 0;
  if (x < a + 1) return 1 - gammaP(a, x);
  // Lentz's continued fraction.
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

// Upper-tail p-value of a chi-square statistic with df degrees of freedom.
export function chiSquareP(x, df) {
  if (x <= 0) return 1;
  return gammaQ(df / 2, x / 2);
}

// Continued fraction for the incomplete beta function (Numerical Recipes betacf).
function betacf(a, b, x) {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a, b), in [0, 1].
export function betaI(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

// Two-sided p-value for a t statistic with df degrees of freedom.
export function tTwoSidedP(t, df) {
  const x = df / (df + t * t);
  return betaI(df / 2, 0.5, x);
}

// Standard normal cumulative distribution, via the error function.
export function normalCDF(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Error function via a rational approximation (Abramowitz & Stegun 7.1.26),
// accurate to ~1.5e-7 — plenty for confidence intervals.
export function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}

// Two-sided normal p-value for a z score.
export function normalTwoSidedP(z) {
  return 2 * (1 - normalCDF(Math.abs(z)));
}

// The z multiplier for a given two-sided confidence level (default 95%).
export function zForConfidence(level = 0.95) {
  // Invert the normal CDF at (1 + level) / 2 by bisection — small and exact enough.
  const target = (1 + level) / 2;
  let lo = 0;
  let hi = 8;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (normalCDF(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
