// Chart advisor (build prompt §11). Opinionated: from the shape of the result it
// picks ONE recommended chart and says why, with any alternatives collapsed. A
// pie is only offered when it is genuinely a few parts of a whole (≤4 slices);
// past that it says plainly why bars are better. Nothing here draws anything —
// ChartPreview renders and excelChart.js writes the reproduction steps.

const PIE_MAX_SLICES = 4;
// P1-6: past this many distinct categories, a bar-per-category chart is
// unreadable (and, at real scale, thousands of bars). Refuse plainly instead
// of rendering something nobody can read, and count honestly — this is the
// dataset's real distinct-group count, not a sampled or capped number.
const TOO_MANY_CATEGORIES = 30;

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

  // P1-6: a bar-per-category chart past this many groups is unreadable (and,
  // at real scale, thousands of bars) — a line handles a long time series
  // fine (above), so this only gates the plain-categorical/bar path.
  if (n > TOO_MANY_CATEGORIES) {
    return {
      type: "none",
      reason: `This would compare ${n} categories, which is too many to read as a chart. Pick a column with fewer groups (a bar-per-category chart works well up to about ${TOO_MANY_CATEGORIES}).`,
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

  return {
    type: "bar",
    reason: `Comparing ${n} categories — bars line them up so the differences are easy to see.`,
    alternatives,
    noPieReason,
  };
}
