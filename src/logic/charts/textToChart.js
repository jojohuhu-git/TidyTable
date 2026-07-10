// W4 (Step 9 — "Describe the chart"): parse a free-text chart request
// ("organisms in urine by number of patients", "average duration_days by
// ward") into exactly what the two dropdowns below it already express — a
// label column, an optional numeric value column, an aggregation mode, and
// an optional filter to scope the rows first. Nothing here draws or
// aggregates anything (aggregate.js still builds the dataset) — this module
// only decides WHAT to chart, honestly: an exact, unambiguous read answers
// immediately; anything the app had to stretch for (an abbreviation, a
// partial/token match, more than one equally good column) comes back flagged
// `confidence: "stretched"` so the UI can ask "Did you mean…?" before
// drawing anything, the same middle path Step 3's matcher already uses.
//
// Reuses the W2 offline matcher's column/value primitives (valueMatch.js,
// synonyms.js) instead of re-implementing fuzzy matching from scratch.

import { findColumnCandidates, findValueCandidates, scoreTokenMatch, tokens } from "../offline/valueMatch.js";
import { detectIntent, GROUP_WORDS, detectTopN } from "../offline/synonyms.js";
import { foldKey } from "../checkup/normalizers.js";
import { matchColumn } from "../recipes/recipe.js";

// Generic filler words that carry no column/value meaning for a chart
// request — separate from (and smaller than) the offline Q&A matcher's STOP
// list, since a chart request is usually just "<what> by <how compared>"
// with none of the cohort/comparator vocabulary a Step 3 question has.
const STOP = new Set([
  "the", "a", "an", "of", "in", "on", "by", "for", "with", "and", "or", "to",
  "how", "many", "much", "number", "count", "total", "sum", "average", "mean",
  "show", "chart", "graph", "plot", "compare", "comparing", "per", "each",
  "are", "is", "was", "were", "that", "which", "me", "please", "across",
]);

function termWords(text) {
  return tokens(text).filter((w) => !STOP.has(w));
}

function isNumeric(sheet, name) {
  const h = sheet.headers.find((x) => x.name === name);
  return Boolean(h) && (h.type === "number" || h.type === "mixed (text + numbers)");
}

function valueIndex(sheet) {
  const index = new Map();
  for (const h of sheet.headers) {
    const m = new Map();
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") continue;
      const k = foldKey(v);
      if (!m.has(k)) m.set(k, v);
    }
    index.set(h.name, m);
  }
  return index;
}

// Slide a 1-3 word window across the text and find the header(s) whose name
// best matches some span, e.g. "organisms in urine" -> "Urine Organisms" (the
// span "organisms urine" is an exact token-set match once "in" is stripped).
// Returns { column, score, span, ties } — `ties` lists any OTHER header names
// that scored just as well at the winning span, so an ambiguous request can
// be flagged rather than silently picking the first one.
function bestColumnSpan(text, headerPool) {
  const words = termWords(text);
  let best = null;
  for (let size = Math.min(3, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const span = words.slice(i, i + size);
      for (const h of headerPool) {
        const score = scoreTokenMatch(span, tokens(h.name));
        if (score == null) continue;
        if (!best || score > best.score || (score === best.score && span.length > best.span.length)) {
          best = { column: h.name, score, span, ties: [] };
        } else if (score === best.score && span.length === best.span.length && h.name !== best.column) {
          best.ties.push(h.name);
        }
      }
    }
  }
  return best;
}

// A "by X" / "per X" / "grouped by X" marker whose phrase fuzzy-matches a
// real header — the label/grouping column for the chart. Longest marker
// first so "grouped by" wins over the bare "by" inside it.
function resolveGroupMarker(text, headers) {
  const markers = [...GROUP_WORDS].sort((a, b) => b.length - a.length);
  for (const marker of markers) {
    const re = new RegExp(`(^|[^a-z])${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+([a-z0-9][a-z0-9 _-]*)`, "i");
    const m = re.exec(text);
    if (!m) continue;
    const phrase = termWords(m[2]).join(" ");
    if (!phrase) continue;
    const start = m.index + m[1].length;
    const end = start + (m[0].length - m[1].length);
    const exact = matchColumn(phrase, headers);
    if (exact) return { column: exact, start, end, stretched: false, ties: [] };
    const fuzzy = findColumnCandidates(phrase, headers);
    if (fuzzy.length) return { column: fuzzy[0], start, end, stretched: true, ties: fuzzy.slice(1, 3) };
  }
  return null;
}

// Public: read a free-text chart request against the sheet actually being
// charted. Returns:
//   { status: "none", reason, message }               — send the user to the
//                                                          dropdowns instead
//   { status: "resolved", labelCol, valueCol, aggMode,
//     filter, confidence, lookedFor, ignored, ties }   — confidence is
//                                                          "exact" or
//                                                          "stretched"
export function resolveChartRequest(text, sheet) {
  const raw = String(text || "").trim();
  if (!raw) return { status: "none", reason: "empty", message: "Type what you want to compare." };
  if (!sheet?.headers?.length) return { status: "none", reason: "no-data", message: "Upload a spreadsheet first." };
  const headers = sheet.headers;

  // Phase 4: "top 5"/"most common"/"least common"/"longest"/"shortest" — the
  // Step 9 mirror of the Q&A ranking family (offline/matcher.js's
  // detectTopN). Only the cap/direction transfers to a chart (a full ranked
  // TABLE isn't a chart concept); the words are stripped before the normal
  // label/value search runs, same as an aggregation intent phrase already is.
  const topInfo = detectTopN(raw);
  let workingText = raw;
  if (topInfo) {
    for (const p of [topInfo.topPhrase, topInfo.wordPhrase]) {
      if (!p) continue;
      const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      workingText = workingText.replace(re, " ");
    }
  }

  const intent = detectIntent(workingText);
  let aggMode = "count";
  if (intent?.intent === "average") aggMode = "average";
  else if (intent?.intent === "sum") aggMode = "sum";

  // 1) An explicit "by X"/"per X" grouping column, if the phrase after the
  // marker actually names a real header.
  const group = resolveGroupMarker(workingText, headers);
  let labelCol = null;
  let labelStretched = false;
  let labelTies = [];
  let remainder = workingText;
  if (group) {
    labelCol = group.column;
    labelStretched = group.stretched;
    labelTies = group.ties;
    remainder = (workingText.slice(0, group.start) + " " + workingText.slice(group.end)).trim();
  }

  // 2) A sum/average needs a numeric target column, searched near the intent
  // word (the words right after it first, the common order, then before).
  let valueCol = null;
  let valueStretched = false;
  if (aggMode !== "count") {
    const lower = remainder.toLowerCase();
    const idx = lower.indexOf(intent.phrase);
    const after = idx === -1 ? "" : remainder.slice(idx + intent.phrase.length);
    const before = idx === -1 ? remainder : remainder.slice(0, idx);
    const numericHeaders = headers.filter((h) => isNumeric(sheet, h.name));
    const span = bestColumnSpan(after, numericHeaders) || bestColumnSpan(before, numericHeaders);
    if (!span) {
      const verb = intent.intent === "average" ? "an average" : "a total";
      return {
        status: "none",
        reason: "no-numeric-target",
        message: `This asks for ${verb}, but no numeric column matches what to ${intent.intent}. Pick a column by hand below, or name the number column directly (e.g. "average Duration_days by Ward").`,
      };
    }
    valueCol = span.column;
    valueStretched = span.score < 3;
    remainder = removeSpan(remainder, span.span);
  }

  // 3) No explicit "by X" column named — guess the label column from
  // whatever's left, over every header except the one already claimed as the
  // value column.
  if (!labelCol) {
    const pool = headers.filter((h) => h.name !== valueCol);
    const span = bestColumnSpan(remainder, pool);
    if (!span) {
      return {
        status: "none",
        reason: "no-column-found",
        message: `I couldn't tell which column to compare from "${raw}". Try naming it directly (e.g. "by Ward"), or pick by hand below.`,
      };
    }
    labelCol = span.column;
    labelStretched = span.score < 3;
    labelTies = span.ties;
    remainder = removeSpan(remainder, span.span);
  }

  // 3.5) Honesty bug 2 (2026-07-10): no aggregation word was used, but the
  // leftover words name a NUMERIC column ("duration by diagnosis"). A silent
  // count-by-label would look plausible and be wrong — flip the read to
  // "average of that column?" and flag it stretched so the UI confirms
  // before drawing anything.
  if (!intent && aggMode === "count") {
    const numericPool = headers.filter((h) => isNumeric(sheet, h.name) && h.name !== labelCol);
    const span = bestColumnSpan(remainder, numericPool);
    if (span && span.score >= 2) {
      aggMode = "average";
      valueCol = span.column;
      valueStretched = true;
      remainder = removeSpan(remainder, span.span);
    }
  }

  // 4) Anything meaningful still left over is tried as a value filter
  // ("escherichia coli" in "escherichia coli by ward") — scoped to columns
  // other than the two axes already resolved, so the same word can't both
  // name a column and filter a value. A short leftover word or two (a stray
  // "the"/connective the STOP list didn't catch) is not worth blocking on;
  // anything more that can't be placed is said plainly, never dropped quietly.
  let filter = null;
  let ignored = null;
  const leftover = termWords(remainder);
  if (leftover.length >= 1) {
    const phrase = leftover.join(" ");
    const scopeColumns = headers.map((h) => h.name).filter((n) => n !== labelCol && n !== valueCol);
    const index = valueIndex(sheet);
    const candidates = findValueCandidates(phrase, headers, index, { columns: scopeColumns });
    if (candidates.length) {
      const top = candidates[0];
      filter = { column: top.column, value: top.value };
      if (!top.exact) valueStretched = valueStretched || true; // a stretched filter still confirms before drawing
      if (candidates.some((c) => c.score === top.score && c !== top)) labelStretched = true;
    } else if (leftover.length >= 2 || bestColumnSpan(remainder, headers.filter((h) => h.name !== labelCol && h.name !== valueCol))) {
      // Bug 2 companion: a leftover word that names a COLUMN (not a cell
      // value, e.g. "drug" in "drug by diagnosis") can't be charted as a
      // filter — say so plainly instead of dropping it into a silent count.
      ignored = phrase;
    }
  }

  const confidence = labelStretched || valueStretched || filter?.stretched ? "stretched" : "exact";
  const rank = topInfo ? { n: topInfo.n ?? null, direction: topInfo.direction } : null;
  const lookedFor = describeLookedFor({ labelCol, valueCol, aggMode, filter, rank });

  return {
    status: "resolved",
    labelCol, valueCol, aggMode, filter, confidence, lookedFor, ignored,
    ties: labelTies,
    rank,
  };
}

// Drop each word of a matched span from the text. A plain \b boundary breaks
// on underscore-joined headers ("Duration_days" tokenizes to "duration"/
// "days", but \bduration\b won't match inside "Duration_days" since "_" is a
// word character to regex) — match on the same non-alphanumeric boundary the
// tokenizer itself uses instead.
function removeSpan(text, span) {
  let out = text;
  for (const w of span) {
    const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    out = out.replace(re, (_full, pre, post) => `${pre} ${post}`);
  }
  return out;
}

function describeLookedFor({ labelCol, valueCol, aggMode, filter, rank }) {
  const what = aggMode === "count" ? "a count of rows" : `the ${aggMode} of "${valueCol}"`;
  const where = filter ? ` where "${filter.column}" is "${filter.value}"` : "";
  const capped = rank?.n != null ? `, top ${rank.n}${rank.direction === "least" ? " least common" : ""}` : "";
  return `Comparing ${what} across "${labelCol}"${where}${capped}.`;
}
