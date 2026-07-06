// The Definitions sheet is how the user supplies clinical meaning the app must
// never guess (build prompt §3.2, §8). It is an ordinary worksheet tab named
// "Definitions" with three columns, in plain words:
//
//   term                | column it applies to | values that count
//   oral beta-lactam    | Drug                 | cephalexin, amoxicillin, cefpodoxime
//   excess duration     | Duration_days        | > 7 when Diagnosis = pyelonephritis
//
// The last column is either a list of category values, or a threshold rule with
// an optional "when" guard. A term that appears nowhere — not a header, not a
// value in the data, not here — is blocked, never guessed.

import { columnKey } from "../recipes/recipe.js";

// Clinical terms are matched loosely: punctuation and spaces removed, then a
// trailing "s" dropped, so "oral beta-lactam" == "oral beta lactam" and
// "excess durations" == "excess duration". This is the key both the Definitions
// sheet and the request use, so a user's plural or hyphen never blocks a match.
export function termKey(term) {
  const k = columnKey(term);
  return k.endsWith("s") ? k.slice(0, -1) : k;
}

// Accept a few plain header spellings for each of the three columns.
const TERM_KEYS = ["term", "name", "meaning", "phrase", "definition of"];
const COLUMN_KEYS = ["columnitappliesto", "column", "appliesto", "field", "incolumn", "columnname"];
const VALUE_KEYS = ["valuesthatcount", "values", "counts", "definition", "rule", "meaning", "valuescounted"];

function pickHeader(headers, candidates) {
  for (const c of candidates) {
    const hit = headers.find((h) => columnKey(h.name) === c);
    if (hit) return hit.name;
  }
  return null;
}

const COMPARATOR_RE = /^\s*(>=|<=|<>|>|<|=)\s*(-?\d+(?:\.\d+)?)\s*(?:when\s+(.+))?$/i;

// Parse a "> 7 when Diagnosis = pyelonephritis" style rule. Returns the guard as
// { column, value } or null when there is no "when" clause.
function parseThreshold(raw) {
  const m = String(raw).match(COMPARATOR_RE);
  if (!m) return null;
  const [, op, num, whenClause] = m;
  let when = null;
  if (whenClause) {
    const wm = whenClause.match(/^(.+?)\s*(?:=|\bis\b|\bequals\b)\s*(.+)$/i);
    if (wm) when = { column: wm[1].trim(), value: wm[2].trim() };
  }
  return { op, value: Number(num), when };
}

// Split a value list on commas / semicolons / "or", dropping empties.
function parseValueList(raw) {
  return String(raw)
    .split(/[,;]|\bor\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Build the lookup from a workbook. Returns { present, byTerm } where byTerm is a
// Map from folded term -> definition object. `present` is false when there is no
// Definitions sheet at all, which the matcher reports differently from an empty
// one (so the user is told to add the sheet, not just a row).
export function parseDefinitions(workbook) {
  const sheet = (workbook?.sheets || []).find((s) => columnKey(s.name) === "definitions");
  if (!sheet) return { present: false, byTerm: new Map() };

  const termCol = pickHeader(sheet.headers, TERM_KEYS) || sheet.headers[0]?.name;
  const columnCol = pickHeader(sheet.headers, COLUMN_KEYS) || sheet.headers[1]?.name;
  const valueCol = pickHeader(sheet.headers, VALUE_KEYS) || sheet.headers[2]?.name;

  const byTerm = new Map();
  for (const row of sheet.rows) {
    const term = row[termCol];
    const columnName = row[columnCol];
    const raw = row[valueCol];
    if (term == null || String(term).trim() === "") continue;
    const threshold = raw != null ? parseThreshold(raw) : null;
    byTerm.set(termKey(term), {
      term: String(term).trim(),
      columnName: columnName != null ? String(columnName).trim() : null,
      kind: threshold ? "threshold" : "values",
      op: threshold?.op || null,
      value: threshold ? threshold.value : null,
      when: threshold?.when || null,
      values: threshold ? [] : (raw != null ? parseValueList(raw) : []),
    });
  }
  return { present: true, byTerm };
}

// Look a term up by its loose key. Returns the definition or null.
export function lookupDefinition(defs, term) {
  if (!defs || !defs.byTerm) return null;
  return defs.byTerm.get(termKey(term)) || null;
}
