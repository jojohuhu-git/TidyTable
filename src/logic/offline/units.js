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

// Phase 7.3 (2026-07-10): number words + unit conversion in comparators.
// "more than a week" / "over 2 weeks" / "under 48 hours" carry a quantity the
// digit-only threshold parser can't see. We read a small fixed dictionary and
// convert the quantity into the TARGET COLUMN's own unit, always saying the
// conversion (and any approximation) out loud — never a silent stretch.

// Everyday number words, plus "a"/"an" = 1. Deliberately small — anything
// bigger is a digit the existing parser already reads.
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};

// Every recognized time unit, folded to its canonical name, and its size in
// days. A month is an APPROXIMATION (30 days) — stated wherever it is used.
const UNIT_DAYS = {
  day: { unit: "days", days: 1 }, days: { unit: "days", days: 1 },
  week: { unit: "weeks", days: 7 }, weeks: { unit: "weeks", days: 7 },
  hour: { unit: "hours", days: 1 / 24 }, hours: { unit: "hours", days: 1 / 24 },
  hr: { unit: "hours", days: 1 / 24 }, hrs: { unit: "hours", days: 1 / 24 },
  month: { unit: "months", days: 30, approx: true }, months: { unit: "months", days: 30, approx: true },
};

const NUM_WORD_RE = Object.keys(NUMBER_WORDS).join("|");
const UNIT_RE = Object.keys(UNIT_DAYS).join("|");
const QUANTITY_RE = new RegExp(`\\b(${NUM_WORD_RE}|\\d+(?:\\.\\d+)?)\\s+(${UNIT_RE})\\b`, "i");

// Read the first "<number> <time-unit>" (digit or number word) out of a clause,
// or null. "a week" -> { number: 1, unit: "weeks", word: "week" }; "48 hours"
// -> { number: 48, unit: "hours", word: "hours" }. A bare number with no unit
// returns null (the digit-only threshold parser handles that unchanged).
export function parseQuantity(text) {
  const m = QUANTITY_RE.exec(String(text || ""));
  if (!m) return null;
  const numTok = m[1].toLowerCase();
  const number = numTok in NUMBER_WORDS ? NUMBER_WORDS[numTok] : Number(numTok);
  if (!Number.isFinite(number)) return null;
  const spec = UNIT_DAYS[m[2].toLowerCase()];
  return { number, unit: spec.unit, word: m[2].toLowerCase(), days: number * spec.days, approx: Boolean(spec.approx) };
}

// Convert a parsed quantity into the target COLUMN's unit (from its name via
// inferColumnUnit). Returns { value, note, approx } or null when the column's
// unit isn't known — in which case the caller must NOT guess a conversion.
// `note` states the conversion in plain words for the answer line; it is null
// when the quantity is already in the column's unit and needs no explanation.
export function convertQuantityToColumn(quantity, columnName) {
  const columnUnit = inferColumnUnit(columnName);
  if (!columnUnit) return null; // can't convert without knowing the column's unit
  // Size of one column-unit in days: days=1, hours=1/24.
  const perColumnUnit = columnUnit === "hours" ? 1 / 24 : 1;
  const raw = quantity.days / perColumnUnit;
  const value = Math.round(raw * 100) / 100;
  const approx = quantity.approx || value !== Math.round(value);
  if (quantity.unit === columnUnit && !quantity.approx) {
    return { value, note: null, approx: false };
  }
  const eq = quantity.approx ? "≈" : "=";
  const monthNote = quantity.approx ? " (a month taken as 30 days)" : "";
  const note = `${quantity.number} ${quantity.word} ${eq} ${value} ${columnUnit}${monthNote}`;
  return { value, note, approx };
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
