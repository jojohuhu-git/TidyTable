// Item 7 (plan-echo builder): an R script that reproduces a confirmed
// plan-echo plan (filter groups -> measure -> group by -> sort), the third
// output surface alongside the in-app chart and the Excel-recipe steps.
// Entirely new -- no chart/aggregate R generator existed before item 7 (R
// generation was scoped only to the stats/regression feature). Follows
// templates.js's own conventions: a dplyr pipeline, one plain comment above
// each step, the shared beginner-facing HEADER/notes.

import { key, wrap } from "./shared.js";

function filterBody(groups) {
  const real = (groups || []).filter((g) => g.length > 0);
  if (!real.length) {
    return "# No filter -- using every row.\nfiltered <- data\n\n";
  }
  const groupExprs = real.map((g) => g.map((c) => `${key(c.column)} == "${c.value}"`).join(" & "));
  if (real.length === 1) {
    return `# Keep rows matching the filter.\nfiltered <- data %>% filter(${groupExprs[0]})\n\n`;
  }
  // AND-within-group, OR-across-groups: filter each group separately, then
  // bind_rows and distinct() so a row matching more than one group isn't
  // double-counted -- the same "kept if it matches ANY group" semantic
  // filterGroups.js's matchesFilterGroups uses in the app itself.
  const perGroup = real.map((_, i) => `group${i + 1} <- data %>% filter(${groupExprs[i]})`).join("\n");
  const bound = real.map((_, i) => `group${i + 1}`).join(", ");
  return (
    `# Keep rows matching ANY of the filter groups (OR across groups, AND within each).\n` +
    `${perGroup}\n` +
    `filtered <- bind_rows(${bound}) %>% distinct()\n\n`
  );
}

const AGG_EXPR = {
  count: () => "n()",
  sum: (col) => `sum(${key(col)}, na.rm = TRUE)`,
  average: (col) => `mean(${key(col)}, na.rm = TRUE)`,
  median: (col) => `median(${key(col)}, na.rm = TRUE)`,
};

// Backtick a column name for use as a bare R identifier (so a name with
// spaces or punctuation is still valid), e.g. group_by/arrange output columns
// after summarise -- unlike key(), these refer to a column on the RESULT
// tibble, not on `data`.
const ident = (name) => `\`${String(name).replace(/`/g, "")}\``;

export function rChartPlan(plan) {
  const { filterGroups, measure, groupCols, sort } = plan;
  const measureLabel = measure.aggMode === "count" ? "n" : measure.aggMode;
  const aggExpr = AGG_EXPR[measure.aggMode](measure.col);

  let body = filterBody(filterGroups);

  if ((groupCols || []).length) {
    // Named group_by keeps the result's column named exactly like the
    // source column (data[["Ward"]] alone would otherwise become an ugly
    // auto-generated column name in the output).
    const groupExpr = groupCols.map((c) => `${ident(c)} = ${key(c)}`).join(", ");
    body +=
      `# Group by ${groupCols.join(" and ")} and compute the ${measureLabel}.\n` +
      `result <- filtered %>% group_by(${groupExpr}) %>% summarise(${measureLabel} = ${aggExpr}, .groups = "drop")\n`;
  } else {
    body +=
      `# Compute the overall ${measureLabel} (no grouping).\n` +
      `result <- filtered %>% summarise(${measureLabel} = ${aggExpr})\n`;
  }

  if (sort) {
    // Sorting by the group label refers to that column on the RESULT
    // tibble (it survives group_by/summarise under its own name, per the
    // named group_by above) -- sorting by the measure value uses the plain
    // summarise() output name.
    const isLabelSort = (groupCols || []).includes(sort.by);
    const sortExpr = isLabelSort ? ident(sort.by) : measureLabel;
    const wrapped = sort.direction === "desc" ? `desc(${sortExpr})` : sortExpr;
    body += `\n# Sort ${sort.direction === "desc" ? "largest first" : "smallest first, A to Z"}.\n` +
      `result <- result %>% arrange(${wrapped})\n`;
  }

  body += "\nprint(result)";

  const dplyrHeader = `if (!require("dplyr")) install.packages("dplyr")\nlibrary(dplyr)\n\n`;
  const notes =
    `This filters the rows${(groupCols || []).length ? `, groups by ${groupCols.join(" and ")},` : ","} ` +
    `and computes the ${measureLabel}. Compare the "result" table to the numbers the app showed.`;
  return wrap(dplyrHeader + body, notes);
}
