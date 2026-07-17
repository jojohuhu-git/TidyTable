// Numbered Excel steps to reproduce a recommended chart (build prompt §11; W4
// horizontal-bar + helper-table + color steps). They lean on the parts of
// Excel that have been stable for 15 years — select the range, Insert tab,
// pick the chart — and only mention the two or three formatting moves that
// matter. Windows / Mac is noted only where it differs. The steps must
// reproduce the in-app preview exactly — same rows, same sort, same colors —
// so a matching number in Excel is real proof, not a coincidence.

const CHART_LABEL = {
  bar: "Clustered Column",
  "bar-horizontal": "Bar (Clustered Bar)",
  line: "Line with Markers",
  pie: "Pie",
  scatter: "Scatter (X Y)",
};

// P6-1: the crosstab's own layout -> Excel chart name mapping.
const CROSSTAB_CHART_LABEL = {
  grouped: "Clustered Column",
  stacked: "Stacked Column",
  stacked100: "100% Stacked Column",
};

// W4: a helper aggregation table step, spelled out exactly (the same rows,
// in the same order, that the preview drew) — so building the chart from
// numbers already worked out by hand is possible even when the raw sheet
// doesn't have the label/value columns sitting next to each other, and the
// row order is provably the same one behind the chart.
function helperTableStep(dataset) {
  const rows = dataset.points.slice(0, 12).map((p) => `${p.label} — ${p.value}`).join("; ");
  const more = dataset.points.length > 12 ? `, and ${dataset.points.length - 12} more` : "";
  return {
    title: "Build the helper table",
    instruction:
      `In two empty columns, type "${dataset.labelName}" and "${dataset.valueName}" as headers, then one row per ` +
      `category, largest value first, exactly as shown here: ${rows}${more}. This is the same table the preview ` +
      `above drew from — matching it row-for-row is how you know the chart will match.`,
  };
}

// P3-3: name whatever emphasis is on screen (a highlighted category, an
// average/threshold line, the automatic largest-category callout) so the
// hand-built Excel chart isn't a step behind the in-app preview. Returns
// null when nothing is set, so a chart with no emphasis gets no extra step.
function emphasisStep(emphasis) {
  const parts = [];
  if (emphasis.highlightLabel) {
    parts.push(
      `Make the "${emphasis.highlightLabel}" bar stand out: click it once to select just that bar, then ` +
      `Format Data Point > Fill and pick the accent color (or bold its data label).`,
    );
  }
  if (emphasis.referenceLine) {
    const rl = emphasis.referenceLine;
    const desc = rl.label === "average" ? `the average (${rl.value})` : `${rl.value}`;
    parts.push(
      `Add a reference line at ${desc}: put that value in a new column repeated for every row, add it as a ` +
      `second series, then change just that series' chart type to a line (Chart Design > Change Chart Type) so ` +
      `it draws as a dashed marker across the bars.`,
    );
  }
  if (emphasis.extremeCallout) {
    parts.push(`Caption to include: "${emphasis.extremeCallout}".`);
  }
  if (!parts.length) return null;
  return { title: "Match the emphasis", instruction: parts.join(" ") };
}

// P4-2: the preview's points are already grouped by month/quarter — a formula
// so building the same helper table by hand starts from the same raw dates,
// not from numbers that already have the grouping baked in.
function bucketStep(dataset) {
  if (!dataset.bucket) return null;
  const formula = dataset.bucket === "quarter"
    ? `=TEXT(A2,"yyyy")&"-Q"&ROUNDUP(MONTH(A2)/3,0)`
    : `=TEXT(A2,"yyyy-mm")`;
  return {
    title: `Group the dates by ${dataset.bucket}`,
    instruction:
      `Add a helper column next to "${dataset.labelName}" with the formula ${formula} (adjust the cell reference ` +
      `to your first data row, then fill down). Use that helper column, not the raw dates, as the labels in the ` +
      `steps below.`,
  };
}

// P6-1: the helper table for a crosstab is a small grid (one row per label
// category, one column per subgroup) — always a helper table, never "select
// these columns side by side", since the raw sheet is one row per record,
// not already shaped like a crosstab.
function crosstabHelperTableStep(dataset) {
  const header = [dataset.labelName, ...dataset.subgroups].join(" | ");
  const rows = dataset.categories.slice(0, 12)
    .map((c) => `${c.label} — ${dataset.subgroups.map((s, i) => `${s}: ${c.values[i]}`).join(", ")}`)
    .join("; ");
  const more = dataset.categories.length > 12 ? `, and ${dataset.categories.length - 12} more` : "";
  return {
    title: "Build the helper table",
    instruction:
      `In a block of empty columns, type these headers across the top row: ${header}. Then one row per ` +
      `${dataset.labelName}, with each ${dataset.subgroupName} count in its own column, exactly as shown here: ` +
      `${rows}${more}. This is the same table the preview above drew from — matching it row-for-row is how you ` +
      `know the chart will match.`,
  };
}

// P6-1: numbered Excel steps for a grouped/stacked/100%-stacked crosstab.
// `rec` is the advisor's recommendation (recommendChart's return value) —
// only `rec.layout` is read. Kept as a separate function (rather than folded
// into excelChartSteps below) because a crosstab's dataset shape has no
// `points`/`valueName` — every existing step-builder below assumes those.
function crosstabSteps(dataset, rec) {
  const layout = rec.layout || "grouped";
  const label = CROSSTAB_CHART_LABEL[layout] || CROSSTAB_CHART_LABEL.grouped;
  const steps = [crosstabHelperTableStep(dataset)];

  steps.push({
    title: "Insert the chart",
    instruction: `Select the helper table above (including its header row), then go to the Insert tab and choose ` +
      `"${label}" from the Charts group. On Windows and Mac the Insert tab is in the same place; the chart buttons ` +
      `look slightly different but carry the same names.`,
  });

  steps.push({
    title: "Turn on the legend",
    instruction: `Click the chart, then the "+" (Chart Elements) button next to it and make sure "Legend" is ` +
      `checked — with ${dataset.subgroups.length} ${dataset.subgroupName} colors on screen, the legend is what ` +
      `tells them apart.`,
  });

  if (layout === "stacked100") {
    steps.push({
      title: "Check the axis is in percent",
      instruction: `Excel's "100% Stacked Column" scales each bar to 100% automatically. Click the vertical axis ` +
        `and confirm the numbers read as percentages (right-click the axis > Format Axis > Number > Percentage if not).`,
    });
  }

  steps.push({
    title: "Label the axes",
    instruction: `Click the chart title and axis titles and type plain names (for example "${dataset.subgroupName} ` +
      `by ${dataset.labelName}"). Clear labels are the difference between a chart people trust and one they don't.`,
  });

  if (dataset.otherGrouped) {
    steps.push({
      title: "Remember the folded groups",
      instruction: `The smallest ${dataset.otherGrouped} ${dataset.subgroupName} values are combined into "Other" ` +
        `in the helper table above, so the legend stays readable — they are not missing, just grouped together.`,
    });
  }

  if (dataset.filter) {
    steps.push({
      title: "Remember the filter",
      instruction: `This chart only counts rows where "${dataset.filter.column}" is "${dataset.filter.value}" — ` +
        `filter your data to that first (Data > Filter), or the helper table above already reflects it.`,
    });
  }

  steps.push(colorNoteStep());
  return steps;
}

function colorNoteStep() {
  return {
    title: "Match the colors (optional)",
    instruction:
      "The preview's colors come from a small colorblind-safe palette. To match them by hand: select the bars, " +
      "Format Data Series > Fill, and pick from the same palette shown under the preview (or leave Excel's default " +
      "colors — the numbers are what matter, not the exact shade).",
  };
}

// dataset: from aggregate.js. `rec` is the advisor's recommendation object
// (recommendChart's return value) — only `rec.layout` and `rec.offerGroupOther`
// are read, so passing {} is fine for a caller that already knows the type.
// `emphasis` (P3-3, optional): { highlightLabel, referenceLine, extremeCallout }
// — whatever emphasis is currently on the in-app preview, named in words here
// too so the two never drift apart.
// Returns [{ title, instruction }] (no formulas — a chart is clicks, not a
// formula).
export function excelChartSteps(chartType, dataset, rec = {}, emphasis = {}) {
  if (dataset.kind === "crosstab") return crosstabSteps(dataset, rec);
  const steps = [];
  const horizontal = chartType === "bar" && rec.layout === "horizontal";
  const label = CHART_LABEL[horizontal ? "bar-horizontal" : chartType] || "chart";
  const manyRows = dataset.kind !== "xy" && dataset.points.length > 12;

  const bucketStepObj = bucketStep(dataset);
  if (bucketStepObj) steps.push(bucketStepObj);

  if (dataset.kind === "xy") {
    steps.push({
      title: "Select the two number columns",
      instruction: `Select both columns of numbers (${dataset.xName} and ${dataset.yName}), including their header row.`,
    });
  } else if (manyRows) {
    // W4: with this many rows, naming an exact helper table to build (below)
    // is more reliable than "select these columns", since the sheet's raw
    // columns may not be sorted the same way the chart is.
    steps.push(helperTableStep(dataset));
  } else {
    steps.push({
      title: "Select the labels and their values",
      instruction: `Select the ${dataset.labelName} column and the ${dataset.valueName} next to it, including the header row. If they are not side by side, copy them next to each other first.`,
    });
  }

  steps.push({
    title: "Insert the chart",
    instruction: `Go to the Insert tab at the top. In the Charts group, choose "${label}". On Windows and Mac the Insert tab is in the same place; the chart buttons look slightly different but carry the same names.` +
      (horizontal ? ' Excel calls a horizontal bar chart just "Bar" — a plain "Column" chart is the vertical one.' : ""),
  });

  if (chartType === "pie") {
    steps.push({
      title: "Turn on the numbers",
      instruction: "Click the chart, then add data labels (right-click a slice > Add Data Labels) so each slice shows its value. A pie without numbers is hard to read.",
    });
  } else if (chartType === "line") {
    steps.push({
      title: "Check the time order",
      instruction: "Make sure the points run in date order along the bottom. If they don't, sort your label column by date before making the chart.",
    });
  } else {
    steps.push({
      title: "Label the axes",
      instruction: `Click the chart title and axis titles and type plain names (for example "${dataset.valueName || dataset.yName}"). Clear labels are the difference between a chart people trust and one they don't.`,
    });
  }

  if (chartType === "bar") {
    steps.push({
      title: "Sort the bars",
      instruction: horizontal
        ? "The helper table above is already sorted largest to smallest — keep that order when you build the chart, so the biggest category is on top, same as the preview."
        : "Sorting the data from largest to smallest before charting usually makes the comparison easier to read.",
    });
  }

  if (dataset.filter) {
    steps.push({
      title: "Remember the filter",
      instruction: `This chart only counts rows where "${dataset.filter.column}" is "${dataset.filter.value}" — filter your data to that first (Data > Filter), or the helper table above already reflects it.`,
    });
  }

  const emphasisStepObj = emphasisStep(emphasis);
  if (emphasisStepObj) steps.push(emphasisStepObj);

  steps.push(colorNoteStep());

  return steps;
}
