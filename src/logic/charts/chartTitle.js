// B9: a real chart title ("count by Diagnosis") makes an exported PNG
// self-explanatory, and doubles as the "what do these numbers mean" context
// the bar preview was missing (dataset.valueName is already "count" or
// "total X").
export function buildChartTitle(dataset) {
  if (!dataset) return "";
  if (dataset.kind === "xy") return `${dataset.yName} vs ${dataset.xName}`;
  // P6-1: a crosstab title names both axes ("Drug by Diagnosis") — there is
  // no single valueName, since every bar is always a count.
  if (dataset.kind === "crosstab") return `${dataset.subgroupName} by ${dataset.labelName}`;
  // P6-2: a histogram has one column and no comparison axis; a box+dot names
  // both, like a crosstab, but says "spread" so it's never confused with the
  // average-by-group bar it's an alternative to.
  if (dataset.kind === "distribution" && dataset.shape === "histogram") return `Distribution of ${dataset.valueName}`;
  if (dataset.kind === "distribution" && dataset.shape === "boxdot") return `${dataset.valueName} by ${dataset.labelName} — spread`;
  return `${dataset.valueName} by ${dataset.labelName}`;
}
