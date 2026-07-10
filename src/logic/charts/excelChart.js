// Numbered Excel steps to reproduce a recommended chart (build prompt §11). They
// lean on the parts of Excel that have been stable for 15 years — select the
// range, Insert tab, pick the chart — and only mention the two or three
// formatting moves that matter. Windows / Mac is noted only where it differs.

const CHART_LABEL = {
  bar: "Clustered Column",
  line: "Line with Markers",
  pie: "Pie",
  scatter: "Scatter (X Y)",
};

// dataset: from aggregate.js. Returns [{ title, instruction }] (no formulas — a
// chart is clicks, not a formula).
export function excelChartSteps(chartType, dataset) {
  const steps = [];
  const label = CHART_LABEL[chartType] || "chart";

  if (dataset.kind === "xy") {
    steps.push({
      title: "Select the two number columns",
      instruction: `Select both columns of numbers (${dataset.xName} and ${dataset.yName}), including their header row.`,
    });
  } else {
    steps.push({
      title: "Select the labels and their values",
      instruction: `Select the ${dataset.labelName} column and the ${dataset.valueName} next to it, including the header row. If they are not side by side, copy them next to each other first.`,
    });
  }

  steps.push({
    title: "Insert the chart",
    instruction: `Go to the Insert tab at the top. In the Charts group, choose "${label}". On Windows and Mac the Insert tab is in the same place; the chart buttons look slightly different but carry the same names.`,
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
      title: "Sort the bars (optional)",
      instruction: "Sorting the data from largest to smallest before charting usually makes the comparison easier to read.",
    });
  }

  return steps;
}
