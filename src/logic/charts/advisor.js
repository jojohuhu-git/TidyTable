// Chart advisor (build prompt §11; W4 layout intelligence). Opinionated: from
// the shape of the result it picks ONE recommended chart and says why, with
// any alternatives collapsed. A pie is only offered when it is genuinely a
// few parts of a whole (≤4 slices); past that it says plainly why bars are
// better. Nothing here draws anything — ChartPreview renders and
// excelChart.js writes the reproduction steps.
//
// W4 (owner's locked decision): the advisor never refuses a chart just
// because there are a lot of categories. Past MANY_CATEGORIES it recommends
// a HORIZONTAL bar layout (`layout: "horizontal"`) — sorted largest-first,
// labels down the side, the preview grows taller to fit every row — and
// still draws every category. Grouping the smallest ones into "Other" is
// offered as a one-click, reversible option (see aggregate.js
// groupSmallIntoOther), never applied automatically.

const PIE_MAX_SLICES = 4;
const MANY_CATEGORIES = 12;

// P6-1: grouped/stacked/100%-stacked bars for a crosstab of two categorical
// columns. The advisor doesn't choose the layout from the data shape (all
// three are always equally "valid" for the same crosstab) — it reads back
// whatever layout the request's wording asked for (opts.requestedLayout, set
// by textToChart.js from words like "mix"/"breakdown"/"stacked"/"compare"),
// defaulting to "grouped" — comparing sizes side by side — when a hand-picked
// pair of columns carries no wording to go on. The other two layouts are
// offered as alternatives, same "one recommended, others collapsed" pattern
// as every other chart type here.
const CROSSTAB_LAYOUTS = ["grouped", "stacked", "stacked100"];
const CROSSTAB_LAYOUT_NAME = { grouped: "Grouped bars", stacked: "Stacked bars", stacked100: "100% stacked bars" };

function recommendCrosstabLayout(dataset, opts) {
  if (!dataset.categories || dataset.categories.length === 0) {
    return { type: "none", reason: "There is nothing to chart yet." };
  }
  const explicitLayout = CROSSTAB_LAYOUTS.includes(opts.requestedLayout);
  const layout = explicitLayout ? opts.requestedLayout : "grouped";
  const label = `"${dataset.labelName}"`;
  const sub = `"${dataset.subgroupName}"`;
  // P6-5: past MANY_CATEGORIES categories AND enough subgroups that the
  // 8-color cap folded some into "Other", one combined chart is an
  // unreadable wall of bars — recommend a grid of mini charts (one panel per
  // category, one shared scale) instead of refusing or cramming. An explicit
  // layout ask (a layout word in the request, or a clicked alternative) is
  // still honored below, with small multiples offered as the escape hatch.
  const crowded = dataset.categories.length > MANY_CATEGORIES && (dataset.otherGrouped || 0) > 0;
  if (crowded && !explicitLayout) {
    return {
      type: "smallMultiples",
      reason: `Small multiples — a grid of mini charts, one per ${label} — because ${dataset.categories.length} ` +
        `${dataset.labelName} values, each split by ${dataset.subgroupName}, is too much for one readable chart. ` +
        `Every panel shares one scale, so bar lengths compare honestly across panels.`,
      alternatives: CROSSTAB_LAYOUTS.map((l) => ({ type: "bar", layout: l, reason: `${CROSSTAB_LAYOUT_NAME[l]} instead.` })),
      legend: true,
      ...(dataset.otherGrouped ? { otherGroupedNote: `The smallest ${dataset.otherGrouped} ${dataset.subgroupName} values are folded into "Other" so the legend stays readable.` } : {}),
    };
  }
  const reason = {
    grouped: `Grouped bar chart because you're comparing how ${sub} sizes differ across ${label} — each category gets its own cluster of bars, one per ${dataset.subgroupName}.`,
    stacked: `Stacked bar chart because this asks what makes up each ${label} — the ${sub} counts stack into one bar per category.`,
    stacked100: `100% stacked bar chart because this asks for the share or mix of ${sub} within each ${label} — bars scale to 100% so you compare proportions, not raw counts.`,
  }[layout];
  const alternatives = CROSSTAB_LAYOUTS
    .filter((l) => l !== layout)
    .map((l) => ({ type: "bar", layout: l, reason: `${CROSSTAB_LAYOUT_NAME[l]} instead.` }));
  if (crowded) {
    alternatives.push({ type: "smallMultiples", reason: "Small multiples instead — a grid of mini charts, one per category, easier to read at this size." });
  }
  return {
    type: "bar",
    layout,
    reason,
    alternatives,
    legend: true,
    ...(dataset.otherGrouped ? { otherGroupedNote: `The smallest ${dataset.otherGrouped} ${dataset.subgroupName} values are folded into "Other" so the legend stays readable.` } : {}),
  };
}

// P6-2: histogram (one numeric column, no grouping) or box+dot (a numeric
// column's spread within each group). Both are `kind: "distribution"`,
// distinguished by `shape`, since neither has a plain `points` array — like
// the crosstab above, dispatched before the `!dataset.points` guard below.
function recommendDistribution(dataset) {
  if (dataset.shape === "histogram") {
    if (!dataset.bins?.length) return { type: "none", reason: "There is nothing to chart yet." };
    return {
      type: "histogram",
      reason: `Histogram because "${dataset.valueName}" is a number with nothing to group it by — this shows how its values are spread out. ${dataset.binRule}`,
      alternatives: [],
    };
  }
  if (!dataset.groups?.length) return { type: "none", reason: "There is nothing to chart yet." };
  const label = `"${dataset.labelName}"`;
  const val = `"${dataset.valueName}"`;
  return {
    type: "boxdot",
    reason: `Box and dot plot because this compares the SPREAD of ${val} across ${label}, not just one summary number — the box marks the middle 50%, the line is the median, and the dots are the real values.`,
    alternatives: [{ type: "bar", reason: "Average bar instead, for a single summary number per group." }],
  };
}

// P6-2: the cross-offer the spec asks for — an average/total-by-group bar
// chart always offers "see the spread instead" (box+dot), and box+dot always
// offers the summary bar back (above). Only a numeric-by-group bar qualifies
// (not a plain count) — a spread of counts isn't a meaningful ask.
function boxDotAlternative(dataset) {
  if (dataset.valueName === "count" || typeof dataset.valueName !== "string" || !dataset.labelName) return null;
  const noun = dataset.valueName.startsWith("average") ? "Averages" : "Totals";
  return { type: "boxdot", reason: `${noun} hide spread — see the spread instead.` };
}

// dataset shapes:
//   { kind: "categorical", points: [{label, value}], labelIsTime: boolean, valueName }
//   { kind: "xy", points: [{x, y}], xName, yName }
//   { kind: "crosstab", categories: [{label, total, values}], subgroups, labelName, subgroupName }
//   { kind: "distribution", shape: "histogram", bins: [{label, from, to, count}], valueName }
//   { kind: "distribution", shape: "boxdot", groups: [{label, stats, values, n}], labelName, valueName }
export function recommendChart(dataset, opts = {}) {
  if (!dataset) return { type: "none", reason: "There is nothing to chart yet." };
  if (dataset.kind === "crosstab") return recommendCrosstabLayout(dataset, opts);
  if (dataset.kind === "distribution") return recommendDistribution(dataset);
  if (!dataset.points || dataset.points.length === 0) {
    return { type: "none", reason: "There is nothing to chart yet." };
  }

  if (dataset.kind === "xy") {
    return {
      type: "scatter",
      reason: `Scatter plot because "${dataset.xName}" and "${dataset.yName}" are both numbers — a scatter shows how they move together.`,
      alternatives: [],
    };
  }

  const n = dataset.points.length;
  // Phase 8.2: name the column the chart-type decision was made FROM, so the
  // recommendation is said out loud ("Bar chart because \"Diagnosis\" is
  // categories") the same honest way Step 3 spells its filters back.
  const col = dataset.labelName ? `"${dataset.labelName}"` : "the labels";

  if (dataset.labelIsTime) {
    return {
      type: "line",
      reason: `Line chart because ${col} is points in time, so a line shows the change from one to the next.`,
      alternatives: [{ type: "bar", reason: "Bars work too if you care about the exact value at each point more than the trend." }],
    };
  }

  // W4: many categories → a horizontal bar chart, sorted largest-first (see
  // aggregate.js — categorical points are already sorted that way), drawing
  // every one of the n categories. No pie past PIE_MAX_SLICES anyway, so the
  // only decision left is the layout.
  if (n > MANY_CATEGORIES) {
    const boxDotAlt = boxDotAlternative(dataset);
    return {
      type: "bar",
      layout: "horizontal",
      reason: `Horizontal bar chart because ${col} has ${n} categories — laid out largest first, so every one is still readable even though there are a lot of them.`,
      alternatives: boxDotAlt ? [boxDotAlt] : [],
      noPieReason: `A ${n}-slice pie would be unreadable; horizontal bars compare all ${n} categories clearly.`,
      offerGroupOther: n > MANY_CATEGORIES * 2,
    };
  }

  // Plain categories → bars are the safe, always-readable default.
  const alternatives = [];
  let noPieReason = null;
  const hasNegative = dataset.points.some((p) => p.value < 0);
  if (hasNegative) {
    // P2-15: a negative value isn't a share of a whole — a pie slice can't
    // represent it honestly, so never offer one, regardless of slice count.
    noPieReason = "Some values are negative, and a pie can't show a negative share of a whole.";
  } else if (n <= PIE_MAX_SLICES) {
    alternatives.push({ type: "pie", reason: `Only ${n} parts, so a pie is readable if these add up to a whole.` });
  } else {
    noPieReason = `A ${n}-slice pie is hard to read; bars compare ${n} categories clearly.`;
  }
  const boxDotAlt = boxDotAlternative(dataset);
  if (boxDotAlt) alternatives.push(boxDotAlt);

  return {
    type: "bar",
    reason: `Bar chart because ${col} is categories, not numbers or dates — bars line up ${n} of them so the differences are easy to see.`,
    alternatives,
    noPieReason,
  };
}
