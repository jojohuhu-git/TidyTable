// B12: role="img" charts had a generic aria-label ("Bar chart") with no
// data in it. Build a one-sentence summary ("UTI 3, Pneumonia 2") a screen
// reader user can act on without seeing the SVG, capped so a long tail of
// categories doesn't turn into an unreadable wall of numbers.
const SUMMARY_CAP = 5;

// P3-3: `opts.highlightLabel` and `opts.referenceLine` let a screen-reader
// user hear the same emphasis a sighted user sees on the SVG (a highlighted
// bar's accent color, a dashed reference line) instead of losing it.
export function buildChartAriaSummary(dataset, cap = SUMMARY_CAP, opts = {}) {
  if (!dataset?.points?.length) return "";
  const shown = dataset.points.slice(0, cap);
  const parts = shown.map((p) => `${p.label} ${p.value}`);
  const more = dataset.points.length - shown.length;
  if (more > 0) parts.push(`and ${more} more`);
  let summary = parts.join(", ");
  if (opts.highlightLabel) summary = `Highlighted: ${opts.highlightLabel}. ${summary}`;
  if (opts.referenceLine) {
    const rl = opts.referenceLine;
    summary += `. Reference line at ${rl.label === "average" ? `average (${rl.value})` : rl.value}`;
  }
  return summary;
}
