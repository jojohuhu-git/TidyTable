// Item 7 (plan-echo builder): the plain-English summary line shown above the
// Run button. Deliberately a generic, literal template — never invented
// wording, never a role-guessing natural-language generator (a
// clinical-vocabulary version was proposed and explicitly rejected 2026-07-18
// in favor of staying honest across arbitrary datasets). Every word in the
// output must be a real column name, a real value, or one of a fixed small
// set of template words (of, for, rows, where, and, or, grouped, by, sorted).

function capitalizeAgg(aggMode) {
  if (aggMode === "count") return "Count";
  return aggMode[0].toUpperCase() + aggMode.slice(1);
}

export function summarizePlan(plan) {
  const { filterGroups, measure, groupCols, sort } = plan;

  const measurePart = measure.col
    ? `${capitalizeAgg(measure.aggMode)} of ${measure.col}`
    : "Count of rows";

  const groupsReal = (filterGroups || []).filter((g) => g && g.length > 0);
  const filterPart = groupsReal.length
    ? ", for rows where " + groupsReal
      .map((g) => g.map((c) => `${c.column} = ${c.value}`).join(" and "))
      .join(", or ")
    : "";

  const groupPart = (groupCols || []).length ? `, grouped by ${groupCols.join(" and ")}` : "";
  const sortPart = sort ? `, sorted by ${sort.by}` : "";

  return `${measurePart}${filterPart}${groupPart}${sortPart}.`;
}
