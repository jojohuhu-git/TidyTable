// B10: StatsPanel/RegressionWizard dropdowns used to list every column
// undifferentiated, so a novice could pick "Patient ID" as a grouping column
// and get a confusing "needs exactly two groups; it has 5" message. Badge
// each option with its type/cardinality and put the columns most likely to
// fit the role first — presentation only, reusing B6's column profile.

import { buildColumnProfile } from "./columnProfile.js";

const GROUPING_MAX_DISTINCT = 10;

// NEW-5: buildColumnProfile also reports "number (stored as text)" for a
// column that's really numeric but not yet coerced — treat it as numeric
// here too, so it isn't badged/ranked like a free-text column.
const isNumericType = (type) => type === "number" || type === "number (stored as text)";

function badgeFor(p) {
  if (p.isEmpty) return "empty";
  if (isNumericType(p.type)) return p.type;
  return `text · ${p.distinctCount} value${p.distinctCount === 1 ? "" : "s"}`;
}

// role: "grouping" (few-distinct, non-numeric columns first — good for a
// t-test/chi-square group split), "outcome" (numeric columns first), or
// "any" (badges only, original column order kept).
export function columnPickerOptions(sheet, role = "any") {
  const profile = buildColumnProfile(sheet);
  const likely = (p) => {
    if (role === "grouping") return !isNumericType(p.type) && p.distinctCount >= 2 && p.distinctCount <= GROUPING_MAX_DISTINCT;
    if (role === "outcome") return isNumericType(p.type);
    return false;
  };
  const options = profile.map((p) => ({ name: p.name, badge: badgeFor(p), likely: likely(p) }));
  if (role === "any") return options;
  // Array.prototype.sort is stable (ES2019+), so within each bucket the
  // original column order survives.
  return [...options].sort((a, b) => Number(b.likely) - Number(a.likely));
}
