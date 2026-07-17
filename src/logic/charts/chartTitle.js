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
  return `${dataset.valueName} by ${dataset.labelName}`;
}
