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
import { matchRequest } from "../offline/matcher.js";

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

// P4-2: "trend"/"over time"/"by month"/"by quarter" wording asks for a
// time-series chart, grouped by calendar period rather than one point per
// exact date. Scoped to Step 9 only (not synonyms.js's GROUP_WORDS, which
// Step 3's Q&A engine also reads — "over" already means a numeric threshold
// there, e.g. "duration over 7", so mixing the two vocabularies would create
// a real ambiguity outside this file). Each entry's regex is global so every
// occurrence of its phrasing (e.g. both "trend" and "over time" in the same
// request) gets stripped, not just the first.
const TIME_TREND_PATTERNS = [
  { re: /\b(by\s+quarter|quarterly|per\s+quarter|over\s+the\s+quarters?)\b/gi, bucket: "quarter" },
  { re: /\b(by\s+month|monthly|per\s+month)\b/gi, bucket: "month" },
  { re: /\b(trend(?:s|ing)?|over\s+time|over\s+the\s+months?)\b/gi, bucket: "month" },
];

// Finds a time-trend phrase and resolves it to the sheet's one date-typed
// column. Declines honestly (never guesses) when there is no date column, or
// more than one and the request doesn't say which. Returns null when no
// trend phrasing is present at all, so the caller falls through to the
// ordinary "by X" grouping path.
function resolveTimeTrend(text, headers) {
  let matched = null;
  for (const p of TIME_TREND_PATTERNS) {
    p.re.lastIndex = 0;
    if (p.re.test(text)) { matched = p; break; }
  }
  if (!matched) return null;
  const dateCols = headers.filter((h) => h.type === "date");
  if (dateCols.length !== 1) {
    return {
      status: "none",
      reason: dateCols.length === 0 ? "no-date-column" : "ambiguous-date-column",
      message: dateCols.length === 0
        ? `This asks for a trend over time, but I couldn't find a column typed as a date yet. Fix the date column in Step 2 ("Dates in a mixed or text format") first, then try again.`
        : `This asks for a trend over time, but there's more than one date column (${dateCols.map((h) => h.name).join(", ")}). Name the one you mean directly, or pick by hand below.`,
    };
  }
  matched.re.lastIndex = 0;
  const strippedText = text.replace(matched.re, " ").replace(/\s+/g, " ").trim();
  return { dateCol: dateCols[0].name, bucket: matched.bucket, strippedText };
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

// P6-1 (R7 — flips the old P3-2 interim decline into real support): a
// two-categorical-column request — grouped/stacked/100% stacked bars, the
// subgroup column color-coded within each label category. Tried BEFORE the
// single-column pipeline below so an explicit two-column phrasing ("drug mix
// by diagnosis") is never misread as one column with leftover noise. Each
// pattern's first capture is the SUBGROUP (the inner, color-coded axis) and
// the second is the LABEL (the outer axis, one cluster/stack per value) —
// the same "the word after by/per/across is the outer axis" convention
// resolveGroupMarker already uses everywhere else in this file.
const CROSSTAB_PATTERNS = [
  { re: /\bbreakdown\s+of\s+(.+?)\s+within\s+each\s+(.+)/i, layout: "stacked100" },
  { re: /\bbreakdown\s+of\s+(.+?)\s+(?:by|across|per)\s+(.+)/i, layout: "stacked100" },
  { re: /^(.+?)\s+mix(?:es)?\s+by\s+(.+)$/i, layout: "stacked100" },
  { re: /\bshares?\s+of\s+(.+?)\s+(?:by|across|per|within\s+each)\s+(.+)/i, layout: "stacked100" },
  { re: /\bproportions?\s+of\s+(.+?)\s+(?:by|across|per|within\s+each)\s+(.+)/i, layout: "stacked100" },
  { re: /^(.+?)\s+by\s+(.+?)\s+stacked\s*$/i, layout: "stacked" },
  { re: /^(.+?)\s+by\s+(.+?)\s+(?:grouped|clustered)\s*$/i, layout: "grouped" },
  { re: /\bcompar(?:e|ing)\s+(.+?)\s+(?:use\s+)?(?:between|across)\s+(.+)/i, layout: "grouped" },
];

const CROSSTAB_LAYOUT_LABEL = { grouped: "grouped bars", stacked: "stacked bars", stacked100: "100% stacked bars" };

// A layout word anywhere in the request, for the bare "X by Y" fallback
// (below) that has no dedicated sentence pattern of its own — same signal
// words, looser match.
function detectCrosstabLayoutWord(text) {
  if (/\b(mix(?:es)?|breakdown|shares?\s+of|proportions?\s+of|100%?\s*stacked)\b/i.test(text)) return "stacked100";
  if (/\bstacked\b/i.test(text)) return "stacked";
  if (/\b(compar(?:e|ing)|grouped|clustered)\b/i.test(text)) return "grouped";
  return null;
}

function resolveCrosstabSignal(raw, sheet, headers) {
  for (const { re, layout } of CROSSTAB_PATTERNS) {
    const m = raw.match(re);
    if (!m) continue;
    const subgroupSpan = bestColumnSpan(m[1], headers);
    const labelSpan = bestColumnSpan(m[2], headers);
    if (!subgroupSpan || !labelSpan) continue;
    if (subgroupSpan.column === labelSpan.column) continue;
    if (isNumeric(sheet, subgroupSpan.column) || isNumeric(sheet, labelSpan.column)) continue;
    return {
      labelCol: labelSpan.column, subgroupCol: subgroupSpan.column, layout,
      stretched: subgroupSpan.score < 3 || labelSpan.score < 3,
    };
  }
  return null;
}

function finishCrosstabPlan({ labelCol, subgroupCol, layout, stretched }) {
  return {
    status: "resolved", kind: "crosstab",
    labelCol, subgroupCol, layout, filter: null,
    confidence: stretched ? "stretched" : "exact",
    lookedFor: `Comparing "${subgroupCol}" within each "${labelCol}" (${CROSSTAB_LAYOUT_LABEL[layout]}).`,
    ignored: null, ties: [], rank: null,
  };
}

// P6-2: "distribution of X" / "histogram of X" / "durations chosen" — a
// single numeric column, no grouping at all. Checked ahead of the
// single-column label/value search below, same "an explicit sentence
// pattern wins" precedence as the crosstab check above. Skipped when the
// phrase also names a by/per/across group marker — that's a numeric-by-group
// ask (an average/sum bar, with box+dot offered as an alternative once it's
// drawn — see advisor.js's boxDotAlternative), not a plain histogram, and
// this file never tries to resolve two different chart shapes from one
// sentence.
const HISTOGRAM_PATTERNS = [
  /^distribution\s+of\s+(.+)$/i,
  /^histogram\s+of\s+(.+)$/i,
  /^spread\s+of\s+(.+)$/i,
  /^(.+?)\s+distribution$/i,
  /^(.+?)\s+chosen$/i,
];
const HISTOGRAM_GROUP_MARKER = /\b(by|per|across|within\s+each|for\s+each)\b/i;

function resolveHistogramSignal(raw, sheet, headers) {
  for (const re of HISTOGRAM_PATTERNS) {
    const m = raw.match(re);
    if (!m) continue;
    const phrase = m[1];
    if (HISTOGRAM_GROUP_MARKER.test(phrase)) continue; // a by-group ask, not a plain histogram
    const numericHeaders = headers.filter((h) => isNumeric(sheet, h.name));
    const span = bestColumnSpan(phrase, numericHeaders);
    if (!span) continue;
    return { valueCol: span.column, stretched: span.score < 3 };
  }
  return null;
}

function finishHistogramPlan({ valueCol, stretched }) {
  return {
    status: "resolved", kind: "distribution", shape: "histogram",
    valueCol, filter: null,
    confidence: stretched ? "stretched" : "exact",
    lookedFor: `Distribution of "${valueCol}".`,
    ignored: null, ties: [], rank: null,
  };
}

// Phase 8.1 — "one brain, two steps". A chart request is read through the SAME
// Step 3 pipeline (matchRequest) FIRST, so every Step 3 improvement — synonyms,
// learned aliases, negation, typo tolerance, cohort filters — transfers to
// Step 9 for free. Only when the pipeline confidently resolves a request into a
// shape a single chart can draw (a group/label column, an optional numeric
// aggregation, an optional single-value cohort filter, an optional top-N cap)
// do we take its plan. Anything the shared pipeline doesn't recognize as a
// question (a bare column name, a value-only scope like "e coli by ward" with
// no counting verb — the natural way people describe a chart) falls back to the
// chart-specific local parser below, which is more liberal about turning a bare
// column into "chart this column". Honesty is preserved on both paths: a
// confident cohort the chart can't represent (a threshold, a negation, or more
// than one filter) is declined plainly, never silently drawn as a wrong chart.
//
// Returns:
//   { status: "none", reason, message }               — send the user to the
//                                                          dropdowns instead
//   { status: "resolved", labelCol, valueCol, aggMode,
//     filter, confidence, lookedFor, ignored, ties }   — confidence is
//                                                          "exact" or
//                                                          "stretched"
export function resolveChartRequest(text, sheet, options = {}) {
  const raw = String(text || "").trim();
  if (!raw) return { status: "none", reason: "empty", message: "Type what you want to compare." };
  if (!sheet?.headers?.length) return { status: "none", reason: "no-data", message: "Upload a spreadsheet first." };

  // One brain: run the request through the shared Step 3 pipeline first.
  const workbook = { sheets: [sheet] };
  const match = matchRequest(raw, workbook, options.defs || { present: false }, options.matchOptions || {});
  if (match.status === "confident") {
    const mapped = chartPlanFromMatch(match);
    if (mapped === UNSUPPORTED_FILTER) {
      // The pipeline understood a cohort the chart's single-value filter can't
      // honestly express (a threshold like "over 7 days", a negation, or more
      // than one condition). Say so plainly — never draw a plausible-but-wrong
      // chart that quietly ignores part of the filter.
      return {
        status: "none",
        reason: "complex-filter",
        message: `I understood your request, but a chart here can only narrow to a single exact value (like "for UTI"). ${match.lookedFor || ""} Ask that in Step 3 and use "Chart this", or pick columns by hand below.`.trim(),
      };
    }
    if (mapped) return finishMatchedPlan(mapped);
    // Confident, but not a shape one chart can draw (a plain number, a distinct
    // count, a Table 1, a whole-column describe/median, or a magnitude ranking):
    // fall through to the local parser, which may still find a plain column to
    // chart, or decline honestly.
  }

  return resolveChartLocally(raw, sheet);
}

// A confident cohort that a single equality filter can't represent — the caller
// declines plainly rather than dropping part of the filter into a wrong chart.
const UNSUPPORTED_FILTER = Symbol("unsupported-filter");

// Map a confident matchRequest result to the chart plan the pickers below
// express — { labelCol, valueCol, aggMode, filter, rank } — or null when the
// result isn't a single-chart shape (so the caller falls back to the local
// parser). Returns UNSUPPORTED_FILTER when the request resolved but its cohort
// can't be drawn as one equality filter.
function chartPlanFromMatch(match) {
  const filter = stagesToFilter(match.stages || []);
  if (filter === UNSUPPORTED_FILTER) return UNSUPPORTED_FILTER;

  // Top-N frequency ("top 5 drugs", "least common diagnosis") → a capped,
  // sorted bar of that column. Magnitude ranking ("longest duration") ranks raw
  // rows, not categories, so it is left to the local parser (unchanged).
  if (match.intent === "topN" && match.topN) {
    if (match.topN.family !== "frequency") return null;
    // The Q&A default for a frequency ranking with no stated count is the FULL
    // ranked table (Infinity); a chart expresses "no cap, just reorder" as null.
    const n = match.topN.n === Infinity || match.topN.n == null ? null : match.topN.n;
    return {
      labelCol: match.topN.targetColumn, valueCol: null, aggMode: "count",
      filter, rank: { n, direction: match.topN.direction },
    };
  }

  // average / sum of a numeric column, broken down by a group column.
  if (match.intent === "average" || match.intent === "sum") {
    const agg = match.aggregation;
    if (!agg || !agg.groupColumn || !agg.targetColumn) return null; // needs something to compare across
    return { labelCol: agg.groupColumn, valueCol: agg.targetColumn, aggMode: match.intent, filter, rank: null };
  }

  // count / share broken down by a group column ("patients by ward",
  // "how many with UTI by ward").
  if (match.intent === "count" || match.intent === "proportion") {
    if (!match.groupColumn) return null; // a single number, not a chart
    return { labelCol: match.groupColumn, valueCol: null, aggMode: "count", filter, rank: null };
  }

  // distinct / median / quartiles / describe / table1 aren't single-group charts.
  return null;
}

// Reduce a confident plan's cohort stages to the chart's single equality
// filter. Zero stages → no filter. Exactly one plain value-equality condition →
// that filter. Anything else (a threshold, a negation with op "<>", a set, or
// more than one stage) can't be drawn as one equality filter — signal it so the
// caller declines instead of silently charting the wrong rows.
function stagesToFilter(stages) {
  if (!stages.length) return null;
  if (stages.length > 1) return UNSUPPORTED_FILTER;
  const c = stages[0].condition;
  if (c && c.kind === "value" && c.op === "=" && !c.negated) {
    return { column: c.column, value: c.value };
  }
  return UNSUPPORTED_FILTER;
}

// Finish a plan resolved through the shared pipeline. These are always EXACT —
// any stretch (an abbreviation, a concept column, a typo) comes back from
// matchRequest as needs_confirm, not confident, so it never reaches here.
function finishMatchedPlan({ labelCol, valueCol, aggMode, filter, rank }) {
  return {
    status: "resolved",
    labelCol, valueCol, aggMode,
    filter: filter === UNSUPPORTED_FILTER ? null : filter,
    confidence: "exact",
    lookedFor: describeLookedFor({ labelCol, valueCol, aggMode, filter: filter === UNSUPPORTED_FILTER ? null : filter, rank }),
    ignored: null,
    ties: [],
    rank: rank || null,
    via: "step3",
  };
}

// Local chart-specific parser (the pre-Phase-8 resolver, now the fallback for
// requests the shared pipeline doesn't treat as a question). Reads a free-text
// chart request against the sheet actually being charted.
function resolveChartLocally(raw, sheet) {
  const headers = sheet.headers;

  // P6-1: an explicit two-column sentence pattern ("drug mix by diagnosis",
  // "compare drug use between diagnoses") is checked first, ahead of every
  // single-column reading below.
  const crosstab = resolveCrosstabSignal(raw, sheet, headers);
  if (crosstab) return finishCrosstabPlan(crosstab);

  // P6-2: "distribution of X" / "durations chosen" — a plain histogram,
  // checked right after the crosstab signal, ahead of everything below that
  // assumes a grouping column.
  const histogram = resolveHistogramSignal(raw, sheet, headers);
  if (histogram) return finishHistogramPlan(histogram);

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

  // P4-2: "trend"/"over time"/"by month"/"by quarter" resolves straight to
  // the sheet's date-typed column, ahead of the ordinary "by X" marker —
  // a trend request never also names its grouping column by name.
  const trend = resolveTimeTrend(workingText, headers);
  if (trend && trend.status === "none") return trend;
  let bucket = null;
  if (trend) {
    workingText = trend.strippedText;
    bucket = trend.bucket;
  }

  const intent = detectIntent(workingText);
  let aggMode = "count";
  if (intent?.intent === "average") aggMode = "average";
  else if (intent?.intent === "sum") aggMode = "sum";

  // 1) The trend-resolved date column, or an explicit "by X"/"per X" grouping
  // column if the phrase after the marker actually names a real header.
  let labelCol = null;
  let labelStretched = false;
  let labelTies = [];
  let remainder = workingText;
  if (trend) {
    labelCol = trend.dateCol;
  } else {
    const group = resolveGroupMarker(workingText, headers);
    if (group) {
      labelCol = group.column;
      labelStretched = group.stretched;
      labelTies = group.ties;
      remainder = (workingText.slice(0, group.start) + " " + workingText.slice(group.end)).trim();
    }
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
    } else {
      const secondCol = bestColumnSpan(remainder, headers.filter((h) => h.name !== labelCol && h.name !== valueCol));
      if (secondCol) {
        // P6-1 (R7 — flips the old P3-2 interim decline): the leftover names
        // a second REAL column, not just a stray word — e.g. "diagnoses" in
        // "compare drug use between diagnoses". With no numeric value column
        // already claimed and both columns categorical, this is a genuine
        // two-categorical-column crosstab; build it (default layout
        // "grouped", or whatever layout word is present) instead of
        // declining. A value column already claimed (a third variable, e.g.
        // "average duration by ward and diagnosis") stays out of scope —
        // decline, naming every column, rather than silently dropping one.
        if (!valueCol && !isNumeric(sheet, labelCol) && !isNumeric(sheet, secondCol.column)) {
          return finishCrosstabPlan({
            labelCol, subgroupCol: secondCol.column,
            layout: detectCrosstabLayoutWord(raw) || "grouped",
            stretched: labelStretched || secondCol.score < 3,
          });
        }
        return {
          status: "none",
          reason: "two-column",
          message: `That compares more than one thing at once (${labelCol}, ${secondCol.column}${valueCol ? `, ${valueCol}` : ""}). I can chart one relationship at a time for now; pick one, or use Step 7.`,
        };
      } else if (leftover.length >= 2) {
        // Bug 2 companion: leftover text that isn't a real column and isn't a
        // value — say so plainly instead of dropping it into a silent count.
        ignored = phrase;
      }
    }
  }

  const confidence = labelStretched || valueStretched || filter?.stretched ? "stretched" : "exact";
  const rank = topInfo ? { n: topInfo.n ?? null, direction: topInfo.direction } : null;
  const lookedFor = describeLookedFor({ labelCol, valueCol, aggMode, filter, rank, bucket });

  return {
    status: "resolved",
    labelCol, valueCol, aggMode, filter, confidence, lookedFor, ignored,
    ties: labelTies,
    rank,
    bucket,
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

function describeLookedFor({ labelCol, valueCol, aggMode, filter, rank, bucket }) {
  const what = aggMode === "count" ? "a count of rows" : `the ${aggMode} of "${valueCol}"`;
  const where = filter ? ` where "${filter.column}" is "${filter.value}"` : "";
  const capped = rank?.n != null ? `, top ${rank.n}${rank.direction === "least" ? " least common" : ""}` : "";
  const grouping = bucket ? `, grouped by ${bucket}` : "";
  return `Comparing ${what} across "${labelCol}"${where}${capped}${grouping}.`;
}
