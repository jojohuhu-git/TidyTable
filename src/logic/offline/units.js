// Phase 2 (2026-07-10): unit-aware display for duration-like numeric columns.
// Never guesses a unit — a column name must say "day(s)" or "hour(s)" (as a
// whole word, not a substring) for the app to label a number with that unit.
// Anything else that still LOOKS like a duration (e.g. a plain "Duration"
// column with no unit suffix) is shown as a raw number, with the assumption
// stated out loud by the caller (see formatDurationLabel's assumptionNote) —
// never a silently guessed "days".

const DAY_HINT = /(^|[_\s-])days?($|[_\s-])/i;
const HOUR_HINT = /(^|[_\s-])h(ou)?rs?($|[_\s-])/i;
// Column-name hints that a number is duration-like even with no explicit
// day/hour suffix — "Duration", "LOS" (length of stay), "wait time", etc.
const DURATION_LIKE_HINT = /duration|length.?of.?stay|\blos\b|wait.?time|time.?to|\bstay\b/i;

// "days" | "hours" | null (no explicit unit hint in the column name).
export function inferColumnUnit(columnName) {
  const name = String(columnName || "");
  if (DAY_HINT.test(name)) return "days";
  if (HOUR_HINT.test(name)) return "hours";
  return null;
}

// Whether the column's NAME suggests it holds a duration/length-of-stay-style
// number at all (independent of whether the unit is explicit) — gates whether
// unit-aware formatting (or its honest "unit not stated" note) applies. A
// plain "Age" or "Cost" column is left as a raw number, as before.
export function isDurationLikeColumn(columnName) {
  const name = String(columnName || "");
  return Boolean(inferColumnUnit(name)) || DURATION_LIKE_HINT.test(name);
}

// Label a computed value with its column's unit, or say plainly that the unit
// isn't stated when the column is duration-like but has no day/hour hint.
// Returns { text, assumptionNote }: `text` is what to show inline after the
// number ("4.2 days" vs "4.2"); `assumptionNote` is null unless the caller
// should say out loud that a unit could not be determined.
export function formatDurationLabel(value, columnName) {
  if (value == null) return { text: "", assumptionNote: null };
  const unit = inferColumnUnit(columnName);
  if (unit) return { text: `${value} ${unit}`, assumptionNote: null };
  if (isDurationLikeColumn(columnName)) {
    return {
      text: String(value),
      assumptionNote:
        `"${columnName}" looks like a duration, but its name doesn't say "days" or "hours", so this number is shown ` +
        `with no unit — rename the column (e.g. "${columnName}_days") to get a labeled unit.`,
    };
  }
  return { text: String(value), assumptionNote: null };
}
