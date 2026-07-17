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
  // P6-3: the same "top K of N account for P%" caption shown on screen, so a
  // screen-reader user gets the vital-few readout without seeing the dots.
  if (opts.paretoSummary) summary += `. ${opts.paretoSummary}`;
  return summary;
}

// P6-1: a screen-reader summary for a grouped/stacked/100%-stacked crosstab —
// "UTI: cephalexin 3, amoxicillin 2; pneumonia: azithromycin 2, and 1 more"
// — same "a few numbers, honestly capped" idea as buildChartAriaSummary
// above, just two axes deep instead of one.
const CROSSTAB_CATEGORY_CAP = 4;
const CROSSTAB_SUBGROUP_CAP = 4;

export function buildCrosstabAriaSummary(dataset, categoryCap = CROSSTAB_CATEGORY_CAP, subgroupCap = CROSSTAB_SUBGROUP_CAP) {
  if (!dataset?.categories?.length) return "";
  const shownCats = dataset.categories.slice(0, categoryCap);
  const parts = shownCats.map((c) => {
    const nonZero = c.values
      .map((v, i) => ({ label: dataset.subgroups[i], v }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    const shownSub = nonZero.slice(0, subgroupCap).map((x) => `${x.label} ${x.v}`);
    const moreSub = nonZero.length - shownSub.length;
    return `${c.label}: ${shownSub.join(", ")}${moreSub > 0 ? `, and ${moreSub} more` : ""}`;
  });
  const moreCats = dataset.categories.length - shownCats.length;
  let summary = parts.join("; ");
  if (moreCats > 0) summary += `; and ${moreCats} more ${dataset.labelName || "categories"}`;
  return summary;
}

// P6-2: a screen-reader summary for a histogram — the bin rule, then a
// capped list of "range: count" bars, same "a few numbers, honestly capped"
// idiom as buildChartAriaSummary above.
export function buildHistogramAriaSummary(dataset, cap = SUMMARY_CAP) {
  if (!dataset?.bins?.length) return "";
  const shown = dataset.bins.slice(0, cap);
  const parts = shown.map((b) => `${b.label}: ${b.count}`);
  const more = dataset.bins.length - shown.length;
  if (more > 0) parts.push(`and ${more} more bins`);
  let summary = `${dataset.n} values. ${parts.join(", ")}`;
  if (dataset.binRule) summary += `. ${dataset.binRule}`;
  return summary;
}

// P6-2: a screen-reader summary for a box+dot plot — per group, the median
// and quartile range, capped the same way.
export function buildBoxDotAriaSummary(dataset, cap = SUMMARY_CAP) {
  if (!dataset?.groups?.length) return "";
  const shown = dataset.groups.slice(0, cap);
  const parts = shown.map((g) => `${g.label}: median ${g.stats.median}, range ${g.stats.q1}–${g.stats.q3}, n=${g.n}`);
  const more = dataset.groups.length - shown.length;
  if (more > 0) parts.push(`and ${more} more`);
  return parts.join("; ");
}
