// Chart advisor (build prompt §11). Opinionated: from the shape of the result it
// picks ONE recommended chart and says why, with any alternatives collapsed. A
// pie is only offered when it is genuinely a few parts of a whole (≤4 slices);
// past that it says plainly why bars are better. Nothing here draws anything —
// ChartPreview renders and excelChart.js writes the reproduction steps.

const PIE_MAX_SLICES = 4;

// dataset shapes:
//   { kind: "categorical", points: [{label, value}], labelIsTime: boolean, valueName }
//   { kind: "xy", points: [{x, y}], xName, yName }
export function recommendChart(dataset) {
  if (!dataset || !dataset.points || dataset.points.length === 0) {
    return { type: "none", reason: "There is nothing to chart yet." };
  }

  if (dataset.kind === "xy") {
    return {
      type: "scatter",
      reason: `Two number columns — a scatter plot shows how ${dataset.xName} and ${dataset.yName} move together.`,
      alternatives: [],
    };
  }

  const n = dataset.points.length;

  if (dataset.labelIsTime) {
    return {
      type: "line",
      reason: "The labels are points in time, so a line shows the change from one to the next.",
      alternatives: [{ type: "bar", reason: "Bars work too if you care about the exact value at each point more than the trend." }],
    };
  }

  // Plain categories → bars are the safe, always-readable default.
  const alternatives = [];
  let noPieReason = null;
  if (n <= PIE_MAX_SLICES) {
    alternatives.push({ type: "pie", reason: `Only ${n} parts, so a pie is readable if these add up to a whole.` });
  } else {
    noPieReason = `A ${n}-slice pie is hard to read; bars compare ${n} categories clearly.`;
  }

  return {
    type: "bar",
    reason: `Comparing ${n} categories — bars line them up so the differences are easy to see.`,
    alternatives,
    noPieReason,
  };
}
