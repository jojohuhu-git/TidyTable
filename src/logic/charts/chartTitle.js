function baseChartTitle(dataset) {
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

// B9: a real chart title ("count by Diagnosis") makes an exported PNG
// self-explanatory, and doubles as the "what do these numbers mean" context
// the bar preview was missing (dataset.valueName is already "count" or
// "total X"). P6-4: a chart scoped to a cohort ("of cystitis patients, …")
// must say so in the title itself, not just in a hint the reader might miss —
// an exported PNG or Excel chart carries the title but not the app's UI.
export function buildChartTitle(dataset) {
  if (!dataset) return "";
  const base = baseChartTitle(dataset);
  const f = dataset.filter;
  if (!f) return base;
  // Item 7: a plan-echo filter can be a group structure instead of the old
  // single {column,value} shape. A single AND-group with one condition
  // reads exactly like the old title ("X only"); anything with more than
  // one condition or group can't be squeezed into that phrase honestly, so
  // it says "filtered" rather than picking one value and implying the rest
  // don't matter (or, before this fix, printing "undefined only").
  if (f.groups) {
    const real = f.groups.filter((g) => g.length > 0);
    if (!real.length) return base;
    if (real.length === 1 && real[0].length === 1) return `${base} — ${real[0][0].value} only`;
    return `${base} — filtered`;
  }
  return `${base} — ${f.value} only`;
}

// P6-4: the honest row count behind a cohort-filtered chart — "n" in the
// clinical n (%) sense — read from whichever field each dataset shape already
// tracks for exactly this (never a second count, one brain). Returns null
// when a shape has no such field yet (a sum/average categorical bar has no
// countTotal), so the caption below states the filter without inventing a
// number.
function datasetN(dataset) {
  if (!dataset) return null;
  if (dataset.kind === "categorical") return dataset.countTotal ?? null;
  if (dataset.kind === "crosstab") return dataset.categories.reduce((s, c) => s + c.total, 0);
  if (dataset.kind === "distribution" && dataset.shape === "histogram") return dataset.n;
  if (dataset.kind === "distribution" && dataset.shape === "boxdot") return dataset.groups.reduce((s, g) => s + g.n, 0);
  if (dataset.kind === "xy") return dataset.totalPoints;
  return null;
}

// P5-3: the copyable figure caption — composed ONLY from what is actually
// on the chart (its title, the user's footnote, the cohort sentence), never
// invented. Each piece gets a closing period so the result pastes into a
// manuscript figure legend as finished sentences.
export function buildFigureCaption({ title, footnote, cohortCaption } = {}) {
  if (!title) return "";
  const sentence = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
  return [title, footnote, cohortCaption].filter(Boolean).map(sentence).join(" ");
}

// P6-4: "caption says n and the filter" — the sentence shown alongside a
// cohort-scoped chart, honest about exactly which rows it counted. Reuses the
// same "Only counting rows where X is Y" wording the filter picker's own hint
// and the Excel "Remember the filter" step already use, so the phrasing is
// the same wherever a filter shows up.
export function buildCohortCaption(dataset, filter) {
  if (!filter) return "";
  const n = datasetN(dataset);
  const nPart = n != null ? `, n=${n}` : "";
  // Item 7: a plan-echo confirmed plan's filter can carry more than one
  // AND-group (OR'd together) instead of the single {column,value} shape
  // every other caller of this function still uses.
  if (filter.groups) {
    const real = filter.groups.filter((g) => g.length > 0);
    if (!real.length) return "";
    const groupText = real
      .map((g) => g.map((c) => `"${c.column}" is "${c.value}"`).join(" and "))
      .join(", or ");
    return `Only counting rows where ${groupText}${nPart}.`;
  }
  return `Only counting rows where "${filter.column}" is "${filter.value}"${nPart}.`;
}
