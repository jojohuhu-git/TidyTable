// Phase 2 (2026-07-10): clinical reporting-convention formatting. The ask
// carries the format — asking for a mean shows "mean (SD)"; asking for a
// median shows "median (IQR1–IQR3)"; a frequency/count shows "n (%)". Pure
// text formatting over numbers cohort.js's computeNumericStats (or a plain
// count/denominator pair) already computed — no new math lives here.

export function formatMeanSD(mean, sd) {
  if (mean == null) return "no readable numbers";
  if (sd == null) return `${mean} (SD not available — fewer than 2 readable numbers)`;
  return `${mean} (SD ${sd})`;
}

export function formatMedianIQR(median, q1, q3) {
  if (median == null) return "no readable numbers";
  if (q1 == null || q3 == null) return `${median} (IQR not available)`;
  return `${median} (IQR ${q1}–${q3})`;
}

// The standard clinical "n (%)" shorthand for a frequency/count out of a
// cohort total. Matches the same rounding (1 decimal place) the rest of the
// offline engine already uses for a share of rows.
export function formatNPercent(n, total) {
  const pct = total ? Math.round((n / total) * 1000) / 10 : 0;
  return `${n} (${pct}%)`;
}
