// B12: role="img" charts had a generic aria-label ("Bar chart") with no
// data in it. Build a one-sentence summary ("UTI 3, Pneumonia 2") a screen
// reader user can act on without seeing the SVG, capped so a long tail of
// categories doesn't turn into an unreadable wall of numbers.
const SUMMARY_CAP = 5;

export function buildChartAriaSummary(dataset, cap = SUMMARY_CAP) {
  if (!dataset?.points?.length) return "";
  const shown = dataset.points.slice(0, cap);
  const parts = shown.map((p) => `${p.label} ${p.value}`);
  const more = dataset.points.length - shown.length;
  if (more > 0) parts.push(`and ${more} more`);
  return parts.join(", ");
}
