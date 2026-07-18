// The offline matcher (build prompt §8). It reads a plain-English cohort question
// against the real data and the user's Definitions sheet, and returns WHAT it
// understood — never a silent guess. Its job is honesty first: every resolved
// filter is spelled back out in `lookedFor`, an unknown clinical term blocks with
// a request for a definition, and a per-patient question over repeating rows
// stops to ask whether to combine rows first.
//
// It does not execute anything — cohort.js runs the resolved stages over the
// rows and fillPlan.js turns a confident match into a PLAN_SCHEMA plan.

import { columnKey } from "../recipes/recipe.js";
import { foldKey } from "../checkup/normalizers.js";
import { lookupDefinition } from "./definitions.js";
import {
  detectIntent, detectComparator, splitNestedLevels, COHORT_MARKERS, GROUP_WORDS,
  expandClinicalSynonyms, NUMERIC_STAT_INTENTS, detectTopN,
} from "./synonyms.js";
import { findValueCandidates, findColumnCandidates, nearestSuggestions, findTypoCandidates } from "./valueMatch.js";
import { conceptColumnCandidates, valueContentCandidates, isConceptWord } from "./concepts.js";
import { parseQuantity, convertQuantityToColumn } from "./units.js";

// Words that carry no filter meaning — stripped before a term is resolved.
const STOP = new Set([
  "how", "many", "much", "number", "count", "of", "the", "a", "an", "any",
  "patients", "patient", "people", "person", "cases", "case", "who", "whom",
  "with", "that", "which", "received", "receive", "receiving", "got", "get",
  "getting", "given", "had", "have", "has", "were", "was", "are", "is", "and",
  "those", "these", "them", "among", "on", "taking", "took", "take", "did",
  "do", "does", "whose", "their", "for", "in", "to", "then", "also", "still",
  "days", "day",
  // W2f: structural counting/proportion words that describe the QUESTION, not a
  // filter value — so "what percent of rows have X" leaves only "X", instead of
  // treating "percent"/"rows"/"share" as a leftover second condition (a false
  // "I couldn't understand …" partial). None is ever a real cell value.
  "rows", "row", "percent", "percentage", "share", "proportion", "fraction",
  "what", "record", "records", "entries", "entry",
]);

const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);

// P0-1: leading "request verbs" a novice types before the actual question
// ("show me all patients who…", "list all rows where…"). They describe the
// ASK, not a clinical term, so they must be peeled off the front of the request
// before anything tries to resolve them — otherwise the leftover "show me all"
// is mistaken for an undefined term and triggers the Definitions block. Longest
// phrases first so "show me all" wins over "show me". Only a LEADING occurrence
// is stripped, and only when real words remain after it.
const REQUEST_LEAD = [
  "show me all", "show me", "show all", "show", "list all", "list out", "list",
  "pull out", "pull up", "pull", "give me", "give", "display", "find me", "find",
  "get me", "fetch",
];
function stripRequestLead(request) {
  let text = String(request || "").trim();
  // Peel repeatedly so "show me, list all patients" and "give me all the rows"
  // both reduce, but stop as soon as nothing more leads.
  let changed = true;
  while (changed) {
    changed = false;
    const lower = text.toLowerCase();
    for (const lead of REQUEST_LEAD) {
      if (lower.startsWith(lead) && /[^a-z]|$/.test(lower.charAt(lead.length))) {
        const rest = text.slice(lead.length).replace(/^[\s,]+/, "");
        // Only strip if real question words remain — never blank out the whole
        // request (e.g. a lone "list" is left alone to decline normally).
        if (words(rest).length > 0) { text = rest; changed = true; break; }
      }
    }
  }
  return text;
}

// P1-1: a request that asks to SEE the rows themselves, not a number. It is
// triggered by a leading list verb ("show me all patients who…", "list the
// rows where…") or a "sort the rows…" ask. It only turns into a list when no
// counting/aggregation/ranking intent claimed the request first (those always
// win), so "show me how many…" stays a count and "show me the average…" stays
// an average.
function detectListVerb(request) {
  const lower = String(request || "").trim().toLowerCase();
  if (/^sort(ed)?\b/.test(lower)) return true;
  return REQUEST_LEAD.some((v) => lower.startsWith(v) && /[^a-z]|$/.test(lower.charAt(v.length)));
}

// P1-1: words that set the sort DIRECTION on a listed result. Descending words
// put the biggest / newest / most first; ascending words the smallest / oldest.
const SORT_DESC_WORDS = /\b(newest|latest|most recent|recent|highest|largest|greatest|biggest|longest|descending|z-?a|high to low)\b/;
const SORT_ASC_WORDS = /\b(oldest|earliest|lowest|smallest|shortest|ascending|a-?z|alphabetical|low to high)\b/;

// P1-1: pull an optional ordering off a list request. Returns
// { columnPhrase, direction, matchText } or null. `columnPhrase` is the raw
// words after "by"/"sorted by" (resolved to a real header by the caller);
// `matchText` is the whole sort clause so it can be excised before the rest is
// read as filter conditions. Direction defaults to ascending unless a
// descending word ("newest", "highest", …) is present.
const SORT_DIR_WORD = "newest|oldest|latest|earliest|highest|lowest|largest|smallest|greatest|biggest|longest|shortest|most recent|ascending|descending|first|last|a-?z|z-?a|alphabetical";
function parseSortModifier(request) {
  const text = String(request || "");
  // Capture the WHOLE sort clause (to the next comma or end) so its direction
  // words never leak back and get read as a filter value. Three shapes:
  //   1. a "sort/order/rank …" phrase anywhere,
  //   2. a trailing "by <column> <direction> first",
  //   3. a bare trailing "<direction> first".
  let clause = null;
  let m = /\b(?:sort(?:ed)?|order(?:ed)?|rank(?:ed)?)\b[^,]*(?:,|$)/i.exec(text);
  if (m) clause = m[0].replace(/,\s*$/, "");
  if (!clause) {
    m = new RegExp(`\\bby\\s+[a-z0-9_ ]+?\\s+(?:${SORT_DIR_WORD})\\s+first\\b`, "i").exec(text);
    if (m) clause = m[0];
  }
  if (!clause) {
    m = new RegExp(`\\b(?:${SORT_DIR_WORD})\\s+first\\b`, "i").exec(text);
    if (m) clause = m[0];
  }
  if (!clause) return null;
  const cl = clause.toLowerCase();
  const direction = SORT_DESC_WORDS.test(cl) ? "desc" : SORT_ASC_WORDS.test(cl) ? "asc" : "asc";
  // The named column, if any: the words after "by", stopped at a direction word.
  let columnPhrase = null;
  const bym = new RegExp(`\\bby\\s+([a-z0-9_ ]+?)(?=\\s+(?:${SORT_DIR_WORD})\\b|,|$)`, "i").exec(clause);
  if (bym) columnPhrase = bym[1].trim();
  return { columnPhrase, direction, matchText: clause };
}

// The header types (see workbook.js inferType) an average/sum can honestly run
// on. Same set textToChart.js uses for its numeric dropdown.
const NUMERIC_COLUMN_TYPES = new Set(["number", "mixed (text + numbers)"]);

// Phase 2: every intent that resolves a single target column and computes an
// aggregate over it — the original sum/average/distinct plus the new
// descriptive-statistics family and the "describe" panel intent.
const AGGREGATION_INTENTS = new Set([...NUMERIC_STAT_INTENTS, "distinct", "describe"]);

// Fuzzy-match a spoken column phrase to a real header. Exact fold first, then a
// contained-key match so "duration" finds "Duration_days".
function fuzzyColumn(phrase, headers) {
  const key = columnKey(phrase);
  if (!key) return null;
  let hit = headers.find((h) => columnKey(h.name) === key);
  if (hit) return hit.name;
  hit = headers.find((h) => {
    const hk = columnKey(h.name);
    // Honesty bug 1 (2026-07-10): a substring hit on a tiny key matches almost
    // anything — the "s" left over from "what's" found "Diagnosi-s-". Require
    // 3+ characters on both sides before a containment match counts.
    if (key.length < 3 || hk.length < 3) return false;
    return hk.includes(key) || key.includes(hk);
  });
  return hit ? hit.name : null;
}

// Phase 3: filler verbs that describe WHAT happened to a patient but carry no
// filter value of their own ("treated for more than 7 days", "prescribed
// amoxicillin"). They must stay OUT of the STOP set — the concept layer reads
// them to find a column ("treated" -> Duration_days) — but once a real
// condition is resolved they must not count as leftover residue that blocks.
// Some overlap with STOP words that are already dropped; listing them here is
// harmless and keeps the intent explicit.
const FILLER_VERBS = new Set([
  "treated", "treat", "treating", "prescribed", "prescribing", "administered",
  "administering", "lasting", "lasted", "staying", "stayed", "seen", "managed",
  "started", "continued", "using", "used",
]);

// Phase 3: resolve a spoken column phrase to a real header, in honesty order:
//   1. a learned/confirmed COLUMN alias (this file's shape) — exact, no chip.
//   2. an exact/contained header name (fuzzyColumn) — exact, no chip.
//   3. a concept match ("treatment length" -> Duration_days) — a STRETCH,
//      returned with ranked candidates so the caller confirms before trusting it.
//   4. a value-content hint ("antibiotics" -> the drug column) — also a stretch.
// Returns { column, stretched, candidates?, via? } or null. `numericOnly` drops
// non-numeric candidates (used for average/sum targets, which need numbers).
// `aliasMap` may hold column-type entries ({ kind: "column", column }) seeded
// from a just-confirmed chip or the persistent per-file alias store.
function resolveColumnRef(phrase, headers, { aliasMap, index, numericOnly = false } = {}) {
  const clean = String(phrase || "").trim();
  if (!clean) return null;

  // 1. Learned/confirmed column alias.
  const aliasK = foldKey(clean);
  if (aliasMap && aliasMap.has(aliasK)) {
    const a = aliasMap.get(aliasK);
    if (a && a.kind === "column" && a.column && headers.some((h) => h.name === a.column)) {
      return { column: a.column, stretched: false, via: null };
    }
  }

  // 2. Exact / contained header name.
  const exact = fuzzyColumn(clean, headers);
  if (exact) return { column: exact, stretched: false, via: null };

  const numeric = (name) => {
    const h = headers.find((x) => x.name === name);
    return h && h.type && NUMERIC_COLUMN_TYPES.has(h.type);
  };

  // Gate: reach for the concept layer only when the phrase is "clean" — every
  // non-stop word is either a concept word or a recognized filler verb (no
  // foreign word like "uti" or "per" glued on), and at least one concept word is
  // present. This keeps stray words from forcing a low-signal confirm: "uti
  // duration" and "duration per" fall through to the exact/value/compound
  // machinery, while "treated" (filler AND a duration concept) still resolves.
  const nonStop = words(clean).filter((w) => !STOP.has(w) && !/^\d+$/.test(w));
  const foreign = nonStop.filter((w) => !isConceptWord(w) && !FILLER_VERBS.has(w));
  if (foreign.length || !nonStop.some(isConceptWord)) return null;

  // 3. Concept match.
  let cands = conceptColumnCandidates(clean, headers);
  // 4. Value-content hint, if a value index is available.
  if (index) {
    const byValues = valueContentCandidates(clean, headers, index);
    for (const c of byValues) {
      if (!cands.some((x) => x.column === c.column)) cands.push(c);
    }
  }
  if (numericOnly) cands = cands.filter((c) => numeric(c.column));
  if (!cands.length) return null;

  // Phase 5: `candidates` stays the existing top-3 (round 1 must render byte-
  // for-byte as before); `allCandidates` carries the FULL ranked list so the
  // "None of these" refinement loop has real next-best guesses to page
  // through instead of inventing new ones.
  const allCandidates = cands.map((c) => ({ kind: "column", column: c.column, via: c.via }));
  const candidates = allCandidates.slice(0, 3);
  return { column: cands[0].column, stretched: true, candidates, allCandidates, via: cands[0].via };
}

// Precompute, per column, the set of folded cell values so a value scan is quick.
// P4-3: the column's Excel picklist terms (sheet.vocab, read from the file's
// data-validation dropdowns at upload) join the index too, so a legal term no
// row happens to contain yet — "cUTI" on a fresh sheet — is still recognized
// and answers an honest 0 instead of "I don't know that word".
function valueIndex(sheet) {
  const index = new Map(); // header name -> Map(foldedValue -> original value)
  for (const h of sheet.headers) {
    const m = new Map();
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") continue;
      const k = foldKey(v);
      if (!m.has(k)) m.set(k, v);
    }
    for (const term of sheet.vocab?.[h.name] || []) {
      const k = foldKey(term);
      if (k && !m.has(k)) m.set(k, term);
    }
    index.set(h.name, m);
  }
  return index;
}

// Strip filler words from a clause, keeping only the meaningful term words.
function termWords(clause) {
  return words(clause).filter((w) => !STOP.has(w));
}

// A3 Level 2: pull a "per X"/"by X"/"grouped by X" grouping column out of a
// request. Only fires when the phrase after the marker resolves to a real
// header name — otherwise the marker word almost always belongs to an
// ordinary filter clause ("treated by cephalexin" is a Drug value, not a
// grouping column) and is left for resolveCondition to handle as before.
// Longest marker first so "grouped by"/"broken down by" win over a bare "by"
// inside them.
function resolveGroupBy(text, headers, { aliasMap, index } = {}) {
  const markers = [...GROUP_WORDS].sort((a, b) => b.length - a.length);
  for (const marker of markers) {
    const re = new RegExp(`(^|[^a-z])${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index + m[1].length;
    const end = start + marker.length;
    const rest = text.slice(end);
    const stop = rest.search(/,|\bhow many\b|\bhow much\b/i);
    const phraseText = stop === -1 ? rest : rest.slice(0, stop);
    const phrase = termWords(phraseText).join(" ");
    if (!phrase) continue;
    // Phase 3: exact header OR a concept match ("per condition" -> Diagnosis).
    // A concept match is a stretch the caller confirms before grouping.
    const ref = resolveColumnRef(phrase, headers, { aliasMap, index });
    if (ref) {
      return {
        column: ref.column, phrase,
        stretched: ref.stretched, candidates: ref.candidates, allCandidates: ref.allCandidates, via: ref.via,
        start, end: end + (stop === -1 ? rest.length : stop),
      };
    }
  }
  return null;
}

// A light plural -> singular fallback so "how many different diagnoses"
// matches a "Diagnosis" header. Not a real stemmer — just enough for common
// clinical/business nouns (diagnoses, drugs, prescribers, categories).
function singularize(word) {
  if (/oses$/i.test(word)) return word.slice(0, -4) + "osis"; // diagnoses -> diagnosis
  if (/(ches|shes|xes|sses)$/i.test(word)) return word.slice(0, -2);
  if (/ies$/i.test(word)) return word.slice(0, -3) + "y"; // categories -> category
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

// A3 Level 2: pull the column to sum/average/distinct-count out of a request
// — "average duration_days" -> "Duration_days", "total cost" -> "Cost", "how
// many different diagnoses" -> "Diagnosis". Looks at the words right after the
// matched intent phrase first (the common order), then the words before it.
function resolveAggregationTarget(text, intentPhrase, headers, { aliasMap, index, numericOnly = false } = {}) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(intentPhrase);
  if (idx === -1) return null;
  const after = text.slice(idx + intentPhrase.length);
  const before = text.slice(0, idx);
  for (const candidate of [after, before]) {
    const tw = termWords(candidate).filter((w) => !/^\d+$/.test(w));
    if (!tw.length) continue;
    // Exact/contained header first (also try a light singular), then Phase 3's
    // concept + value-content resolution — which returns a stretch to confirm.
    const direct = fuzzyColumn(tw.join(" "), headers) || fuzzyColumn(tw.map(singularize).join(" "), headers);
    if (direct) return { column: direct, stretched: false };
    const ref = resolveColumnRef(tw.join(" "), headers, { aliasMap, index, numericOnly });
    if (ref) return { ...ref, phrase: tw.join(" ") };
  }
  return null;
}

// Phase 4: pull the column to rank out of a top-N/most-common request —
// "most common diagnosis" -> "Diagnosis", "top 5 drugs" -> "Drug", "longest
// duration_days" -> "Duration_days". Strips both the wording phrase ("most
// common") and, if present, the separate "top N" count phrase, then resolves
// the remaining words the same honesty-ordered way an aggregation target
// resolves (exact/contained header first, then Phase 3's concept/value-
// content stretch, which the caller confirms before trusting it).
function resolveTopNTarget(text, topInfo, headers, opts) {
  let remainder = text;
  for (const p of [topInfo.topPhrase, topInfo.wordPhrase]) {
    if (!p) continue;
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    remainder = remainder.replace(re, " ");
  }
  const tw = termWords(remainder).filter((w) => !/^\d+$/.test(w));
  if (!tw.length) return null;
  const direct = fuzzyColumn(tw.join(" "), headers) || fuzzyColumn(tw.map(singularize).join(" "), headers);
  if (direct) return { column: direct, stretched: false };
  const ref = resolveColumnRef(tw.join(" "), headers, opts);
  if (ref) return { ...ref, phrase: tw.join(" ") };
  return null;
}

// W2c: recognize a trailing column hint like "in urine", "under Urine
// Organisms", "from ward", or "<phrase> column". Returns { columns, hintText,
// stretched } when the hint resolves to one or more real headers, or null. Only
// the LAST such phrase is treated as a column scope, since it's the natural
// place a scope lands ("... E. coli in urine"). If the hinted phrase is itself a
// cell value, we do NOT scope on it — the caller then treats it as a value, so
// nothing is double-counted.
function resolveColumnScope(clause, headers, index) {
  const text = String(clause);
  // "<phrase> column" — an explicit column word.
  let m = /\b([a-z0-9][a-z0-9 _-]*?)\s+column\b/i.exec(text);
  let hintPhrase = null;
  let hintText = null;
  if (m) { hintPhrase = m[1].trim(); hintText = m[0]; }
  if (!hintPhrase) {
    // "in|under|from|within <phrase>" — take the last occurrence.
    const re = /\b(?:in|under|from|within)\s+([a-z0-9][a-z0-9 _-]*)$/i;
    const mm = re.exec(text.trim());
    if (mm) { hintPhrase = mm[1].trim(); hintText = mm[0]; }
  }
  if (!hintPhrase) return null;

  const phrase = termWords(hintPhrase).join(" ");
  if (!phrase) return null;

  // If the hint phrase is itself a cell value somewhere, it's a value, not a
  // scope — leave it for the value scan (current behavior), never double-count.
  const asValue = findValueCandidates(phrase, headers, index);
  if (asValue.some((c) => c.exact)) return null;

  // Exact header match first (no stretch), then the token-subset tier.
  const exact = fuzzyColumn(phrase, headers);
  if (exact) return { columns: [exact], hintText, hintPhrase, stretched: false };
  const fuzzy = findColumnCandidates(phrase, headers);
  if (fuzzy.length) return { columns: fuzzy, hintText, hintPhrase, stretched: true };
  return null;
}

// Honesty bug 3 (2026-07-10): negation support. These words used to be dropped
// (or worse, split — "patients with" matched inside "patients withOUT"), so
// "how many patients did NOT get amoxicillin" confidently counted the patients
// who DID. A negation word now inverts the condition it attaches to; one that
// attaches to nothing blocks, never gets dropped. "no" is included, but a
// literal cell value like "No growth" still wins because the exact whole-phrase
// scan runs before negation is considered.
const NEGATION_WORDS = new Set([
  "not", "never", "without", "excluding", "except", "no",
  "didnt", "doesnt", "dont", "isnt", "wasnt", "werent", "hasnt", "havent", "hadnt",
]);

function detectNegation(clause) {
  const text = String(clause)
    .replace(/n[’'`]t\b/gi, "nt") // didn't/doesn't → didnt/doesnt
    .replace(/\b(?:other|rather)\s+than\b/gi, " not ")
    .replace(/\bapart\s+from\b/gi, " not ")
    .replace(/\bexcept\s+for\b/gi, " not ");
  const found = [];
  const kept = [];
  for (const w of words(text)) {
    if (NEGATION_WORDS.has(w)) found.push(w);
    else kept.push(w);
  }
  if (!found.length) return null;
  return { remainder: kept.join(" "), words: found };
}

function invertOp(op) {
  return { ">": "<=", ">=": "<", "<": ">=", "<=": ">", "=": "<>", "<>": "=" }[op] || op;
}

// Flip a resolved positive condition into its negation, keeping the W2 stretch
// annotations so the confirm path still works. `negated: true` and the flipped
// op survive cleanCondition — execution, the Excel steps, and the worker
// transform all key off them, and per-patient grain treats a negated value/set
// as "NO row matches" (see cohort.js positiveCondition).
function negateCondition(cond, negWords, scopeWords) {
  const out = { ...cond, negated: true, negWords };
  if (cond.kind === "value") out.op = "<>";
  else if (cond.kind === "set") out.op = "not-in";
  else if (cond.kind === "threshold") out.op = invertOp(cond.op);
  if (scopeWords && scopeWords.length) out.scopeWords = [...(cond.scopeWords || []), ...scopeWords];
  return out;
}

// Turn a resolved value candidate into a value condition, carrying the real cell
// value so every downstream surface (execution, Excel steps, transform) stays
// identical to a plain exact match. `stretched`/`candidates` drive the middle-
// path "Did you mean…?" confirmation upstream.
function valueCondition(candidate, term, { stretched, candidates, allCandidates, via, scopeWords } = {}) {
  return {
    kind: "value", column: candidate.column, op: "=", value: candidate.value,
    source: "value", term,
    stretched: Boolean(stretched),
    ...(candidates && candidates.length > 1 ? { candidates } : {}),
    // Phase 5: the FULL ranked value-candidate list (not just the strong ties
    // shown in round 1) — after "None of these", the lower-scored matches are
    // the honest next guesses, not new candidates invented mid-loop.
    ...(allCandidates && allCandidates.length > 1 ? { allCandidates } : {}),
    ...(via ? { via } : {}),
    // W2c: words consumed by a column scope ("in urine"), so the residue check
    // in resolveConditions doesn't treat them as a leftover second condition.
    ...(scopeWords && scopeWords.length ? { scopeWords } : {}),
  };
}

// P1-1b: keyword lists for a "<column> is missing / blank / empty" (or "…is
// present / recorded") filter. Negated forms are listed so "not missing" reads
// as PRESENT and "not recorded" reads as MISSING — the plain-English opposites a
// novice actually types. "Missing" uses the SAME sentinel set Step 2's cleanup
// recognizes (see sentinelBlanks in checkup/normalizers.js), so the whole app
// agrees on what "no value" means.
const BLANK_MISSING_KW = [
  "not recorded", "not filled in", "not filled", "unrecorded",
  "missing", "blank", "empty", "has no value", "no value", "n/a", "na",
];
const BLANK_PRESENT_KW = [
  "not missing", "not blank", "not empty",
  "present", "recorded", "filled in", "filled", "has a value", "has value",
];
// Linking words that glue a blank keyword to its column phrase; dropped so
// "lab value is missing" resolves the column "Lab value". "value(s)" is kept —
// it can be part of the column name (Lab_value) — because any "has (no) value"
// keyword already consumed its own "value" word above.
const BLANK_LINK_WORDS = new Set([
  "is", "are", "was", "were", "the", "a", "an", "that", "which", "where",
  "with", "of", "in", "has", "have", "row", "rows", "record", "records",
  "patient", "patients", "entry", "entries", "cell", "cells",
]);

// P1-1b: detect a missing/present filter and resolve its column, or null. When
// the column is resolved by concept (a stretch) it is tagged colStretch so
// buildConfirmation asks "did you mean this COLUMN?", never a cell value.
function detectBlankCondition(clause, headers, index, aliasMap) {
  const norm = " " + String(clause).toLowerCase().replace(/[^a-z0-9/ ]/g, " ").replace(/\s+/g, " ").trim() + " ";
  // Earliest keyword position wins; longest keyword wins at the same position,
  // so "not recorded" beats "recorded" and "not missing" beats "missing".
  let best = null;
  const consider = (kw, present) => {
    const idx = norm.indexOf(" " + kw + " ");
    if (idx < 0) return;
    if (!best || idx < best.idx || (idx === best.idx && kw.length > best.kw.length)) {
      best = { idx, kw, present };
    }
  };
  BLANK_MISSING_KW.forEach((kw) => consider(kw, false));
  BLANK_PRESENT_KW.forEach((kw) => consider(kw, true));
  if (!best) return null;

  const columnPhrase = norm
    .replace(" " + best.kw + " ", " ")
    .split(" ")
    .filter((w) => w && !BLANK_LINK_WORDS.has(w))
    .join(" ")
    .trim();
  if (!columnPhrase) return null;

  let column = fuzzyColumn(columnPhrase, headers);
  let stretch = null;
  if (!column) {
    const ref = resolveColumnRef(columnPhrase, headers, { aliasMap, index });
    if (ref) {
      column = ref.column;
      if (ref.stretched) stretch = { candidates: ref.candidates, allCandidates: ref.allCandidates, via: ref.via, colPhrase: columnPhrase };
    }
  }
  if (!column) return null; // let the normal pipeline report the unknown column

  return {
    kind: "blank", column, present: best.present, source: "column", term: String(clause).trim(),
    ...(stretch ? { stretched: true, colStretch: true, candidates: stretch.candidates, allCandidates: stretch.allCandidates, via: stretch.via, colPhrase: stretch.colPhrase } : {}),
  };
}

// Resolve a single filter phrase into a condition, trying (in order): a "missing/
// present" blank filter, a threshold ("... over 7"), a column scope ("... in
// urine"), an exact/fuzzy value present in the data (value scan), a clinical-
// abbreviation expansion, then the Definitions sheet. Anything left over is a
// missing term the app must refuse to guess — but it comes back with the nearest
// values/columns it CAN see, so the user isn't just told to reach for AI.
// `aliasMap` remembers phrases the user already confirmed this session, so the
// same stretch never asks twice.
function resolveCondition(clause, sheet, headers, index, defs, aliasMap) {
  // P1-1b: a "<column> is missing/blank/empty" (or "…present") filter has no
  // comparator or value to scan, so catch it up front before the value machinery
  // treats the keyword as an undefined term.
  const blank = detectBlankCondition(clause, headers, index, aliasMap);
  if (blank) return blank;

  const compar = detectComparator(clause);
  const numMatch = String(clause).match(/-?\d+(?:\.\d+)?/);
  // Phase 7.3: a "<number> <time-unit>" quantity ("a week", "2 weeks", "48
  // hours") the digit-only parser can't read. Present it here so the threshold
  // branch can convert it into the target column's unit.
  const quantity = parseQuantity(clause);

  // Threshold: a comparator and a number (digit OR a number-word quantity), on
  // a named column.
  if (compar && (numMatch || quantity) && compar.op !== "=") {
    const before = String(clause).toLowerCase().split(compar.phrase)[0];
    // Honesty bug 3 (2026-07-10): "not more than 7" / "never over 7" — a
    // negation word right before the comparator flips it; it used to be
    // dropped as a stop-word, silently answering the OPPOSITE question.
    const negBefore = /\b(?:not|never|no)\s*$/i.exec(before);
    const op = negBefore ? invertOp(compar.op) : compar.op;
    const colBefore = negBefore ? before.slice(0, negBefore.index) : before;
    const colPhrase = termWords(colBefore).join(" ");
    // Phase 3 (filler cleanup): a filler verb glued to the column word
    // ("treated with duration_days over 7") used to defeat the exact match —
    // dropping known filler verbs first lets "duration" resolve exactly.
    const colPhraseCore = termWords(colBefore).filter((w) => !FILLER_VERBS.has(w)).join(" ");
    let column = fuzzyColumn(colPhrase, headers)
      || fuzzyColumn(colPhraseCore, headers)
      || fuzzyColumn(termWords(clause).join(" "), headers);
    let colStretch = null;
    if (!column) {
      // Phase 3: no exact column word ("treated for more than 7 days"). Try the
      // concept layer, numeric-only (a threshold compares a number). A concept
      // hit is a STRETCH the caller confirms; its spoken phrase (colPhrase) is
      // what an accepted chip is remembered against.
      const hint = colPhrase || termWords(clause).filter((w) => !/^\d+$/.test(w)).join(" ");
      const ref = resolveColumnRef(hint, headers, { aliasMap, index, numericOnly: true });
      if (ref) {
        column = ref.column;
        if (ref.stretched) colStretch = { candidates: ref.candidates, allCandidates: ref.allCandidates, via: ref.via, colPhrase: hint };
      }
    }
    if (column) {
      // Phase 7.3: if the clause carried a unit quantity ("2 weeks", "48
      // hours"), convert it into the column's own unit and remember the
      // conversion so the answer line can state it. When the column's unit is
      // unknown (convert returns null), we do NOT guess a raw number — fall
      // through so the clause blocks/asks honestly instead.
      let value;
      let conversionNote = null;
      if (quantity && quantity.unit) {
        const conv = convertQuantityToColumn(quantity, column);
        if (conv) { value = conv.value; conversionNote = conv.note; }
      }
      if (value == null && numMatch) value = Number(numMatch[0]);
      if (value != null) {
        return {
          kind: "threshold", column, op, value, source: "column", term: clause.trim(),
          ...(conversionNote ? { conversionNote } : {}),
          ...(colStretch ? { stretched: true, colStretch: true, candidates: colStretch.candidates, allCandidates: colStretch.allCandidates, via: colStretch.via, colPhrase: colStretch.colPhrase } : {}),
        };
      }
    }
  }

  // W2c: peel off a trailing "in <column>" / "<phrase> column" scope, and drop
  // its words from the value phrase so "e coli in urine" searches for "e coli".
  const scope = resolveColumnScope(clause, headers, index);
  const scopeColumns = scope ? scope.columns : null;
  const scopeStretched = scope ? scope.stretched : false;
  let valueClause = clause;
  let scopeWords = [];
  if (scope && scope.hintText) {
    valueClause = String(clause).replace(scope.hintText, " ");
    // Every real word inside the scope hint ("urine organisms" from "in urine
    // organisms") is consumed by the scope, not left over as a value.
    scopeWords = termWords(scope.hintText);
  }

  const phrase = termWords(valueClause).join(" ");
  if (!phrase) {
    // The clause was ONLY a column scope with no value to look for — nothing to
    // filter on. Let the caller report it as filler rather than a bad guess.
    return null;
  }

  // W2d: a mapping the user already confirmed this session wins immediately, no
  // stretch, no re-ask.
  const aliasKey = foldKey(phrase);
  if (aliasMap && aliasMap.has(aliasKey)) {
    const a = aliasMap.get(aliasKey);
    // Only VALUE aliases resolve here; a column alias ({ kind: "column" }) is
    // for a column reference (aggregation target / group-by / threshold), not a
    // cell-value filter, so it is left for resolveColumnRef.
    if (a && a.kind !== "column" && a.value != null) {
      return valueCondition(a, phrase, { stretched: false, scopeWords });
    }
  }

  const scanColumns = scopeColumns;

  // Run a scan against the scoped column first (W2c); if it finds nothing there,
  // fall back to all columns and flag the fall-back so it counts as a stretch.
  // Returns { candidates, scopedFellBack }.
  const scan = (text) => {
    if (scanColumns) {
      const scoped = findValueCandidates(text, headers, index, { columns: scanColumns });
      if (scoped.length) return { candidates: scoped, scopedFellBack: false };
      const all = findValueCandidates(text, headers, index);
      return { candidates: all, scopedFellBack: all.length > 0 };
    }
    return { candidates: findValueCandidates(text, headers, index), scopedFellBack: false };
  };

  // Tier 1 — an exact whole-phrase value (or a single exact word of a longer
  // clause). Both are the old, no-stretch behavior: answer directly. The word
  // pass keeps "pyelonephritis" resolvable inside "UTI pyelonephritis" without
  // demanding the whole clause be one value.
  const whole = scan(phrase);
  const wholeExact = whole.candidates.find((c) => c.exact);
  if (wholeExact && !whole.scopedFellBack && !scopeStretched) {
    return valueCondition(wholeExact, phrase, { stretched: false, scopeWords });
  }

  // Honesty bug 3: negation. Checked AFTER the whole-phrase exact scan (so a
  // literal value like "No growth" matches as itself) and BEFORE the
  // single-word scan (so "amoxicillin" inside "not amoxicillin" can't hijack
  // the clause positively). The remainder goes back through the full resolve
  // pipeline, then the result is inverted.
  const neg = detectNegation(valueClause);
  if (neg) {
    const inner = neg.remainder.trim()
      ? resolveCondition(neg.remainder, sheet, headers, index, defs, aliasMap)
      : null;
    if (!inner) {
      // A negation word with nothing to attach to — block, never drop.
      return { kind: "missing", term: clause.trim(), reason: "unknown", nearest: nearestSuggestions(phrase, headers, index) };
    }
    if (inner.kind === "value" || inner.kind === "set" || inner.kind === "threshold") {
      return negateCondition(inner, neg.words, scopeWords);
    }
    return inner; // missing/partial — blocks or asks, which is honest either way
  }

  for (const w of termWords(valueClause)) {
    const one = scan(w);
    const oneExact = one.candidates.find((c) => c.exact);
    if (oneExact && !one.scopedFellBack && !scopeStretched) {
      return valueCondition(oneExact, w, { stretched: false, scopeWords });
    }
  }

  // Tier 2 — the token-subset / prefix tier (W2a): "e coli" -> "ESCHERICHIA
  // COLI", or a scoped/ambiguous match. Anything here is a stretch to confirm.
  const { candidates, scopedFellBack } = scan(phrase);
  if (candidates.length) {
    const top = candidates[0];
    const strongTies = candidates.filter((c) => c.score === top.score);
    return valueCondition(top, phrase, {
      // Round 1 stays exactly the strong ties (top score only, max 3) — the
      // whole scored list (all scores) is `allCandidates`, kept for Phase 5.
      stretched: true, candidates: strongTies.slice(0, 3), allCandidates: candidates, scopeWords,
    });
  }

  // W2b: try clinical-abbreviation expansions ("e coli" -> "escherichia coli"),
  // still restricted to the scoped column first. An expansion is ALWAYS a
  // stretch (confirm before answering).
  for (const expanded of expandClinicalSynonyms(phrase)) {
    let exCands = scanColumns
      ? findValueCandidates(expanded, headers, index, { columns: scanColumns })
      : [];
    if (!exCands.length) exCands = findValueCandidates(expanded, headers, index);
    if (exCands.length) {
      const top = exCands[0];
      return valueCondition(top, phrase, {
        stretched: true,
        candidates: exCands.filter((c) => c.score === top.score).slice(0, 3),
        allCandidates: exCands,
        via: `expanded "${phrase}" to "${expanded}"`,
        scopeWords,
      });
    }
  }

  // Definitions sheet — the clinical-knowledge gate.
  const def = lookupDefinition(defs, phrase);
  if (def) {
    const column = def.columnName ? fuzzyColumn(def.columnName, headers) : null;
    if (!column) {
      return { kind: "missing", term: def.term, reason: "definition-column", wantedColumn: def.columnName };
    }
    if (def.kind === "threshold") {
      return {
        kind: "threshold", column, op: def.op, value: def.value, when: def.when,
        source: "definition", term: def.term,
      };
    }
    return { kind: "set", column, op: "in", values: def.values, source: "definition", term: def.term };
  }

  // Phase 7.2: typo tolerance. The phrase matched no value exactly, by token
  // subset, or by abbreviation — but it may be a MISSPELLING of a real value
  // one or two edits away ("amoxicilin" -> "amoxicillin"). Offer the nearest as
  // a confirm chip (a STRETCH, never an auto-answer), restricted to the scoped
  // column first, so a misspelling asks instead of blocking.
  let typo = scanColumns ? findTypoCandidates(phrase, headers, index, { columns: scanColumns }) : [];
  if (!typo.length) typo = findTypoCandidates(phrase, headers, index);
  if (typo.length) {
    const top = typo[0];
    return valueCondition(top, phrase, {
      stretched: true,
      candidates: typo.filter((c) => c.distance === top.distance).slice(0, 3),
      allCandidates: typo,
      via: `"${phrase}" looks like a misspelling of "${top.value}"`,
      scopeWords,
    });
  }

  // W2e: nothing resolved. Refuse to guess, but hand back the nearest values and
  // columns so the UI can offer them as chips instead of just "use AI".
  return { kind: "missing", term: phrase, reason: "unknown", nearest: nearestSuggestions(phrase, headers, index) };
}

// A2: resolveCondition's single-significant-word fallback can match just one
// word of a compound clause (e.g. "UTI" out of "UTI had duration_days over
// 7") and silently ignore the rest. Wrap it: when the match only consumed
// part of the clause and what's left is significant (a comparator+number, or
// 2+ real words), try to resolve the leftover words as a second condition of
// their own. If that succeeds, both conditions are kept (AND-ed, like a
// nested "of those" level). If it fails, refuse rather than silently drop the
// residue — the caller turns this into a "partial" result.
function resolveConditions(clause, sheet, headers, index, defs, aliasMap) {
  const condition = resolveCondition(clause, sheet, headers, index, defs, aliasMap);
  if (!condition) return [];
  if (condition.kind !== "value" || condition.source !== "value") return [condition];

  const fullWords = termWords(clause);
  // W2c: words consumed by the value phrase AND by any column scope ("in urine")
  // are accounted for — as are negation words ("not", "never") the condition
  // absorbed — only genuinely leftover words count as residue.
  const matchedWords = new Set([...words(condition.term), ...(condition.scopeWords || []), ...(condition.negWords || [])]);
  // Phase 3: a recognized filler verb ("treated", "prescribed") next to a
  // resolved condition names WHAT happened, not a second thing to filter on — so
  // it must not count as leftover residue that blocks the answer.
  const residue = fullWords.filter((w) => !matchedWords.has(w) && !FILLER_VERBS.has(w));
  if (residue.length === 0) return [condition]; // the whole clause was the value phrase

  const compar = detectComparator(clause);
  const numMatch = String(clause).match(/-?\d+(?:\.\d+)?/);
  const comparWords = compar ? words(compar.phrase) : [];
  const residueHasComparator = Boolean(
    compar && numMatch && compar.op !== "=" && residue.some((w) => comparWords.includes(w) || w === numMatch[0]),
  );
  if (residue.length < 2 && !residueHasComparator) return [condition]; // a stray leftover word, not worth blocking

  const second = resolveCondition(residue.join(" "), sheet, headers, index, defs, aliasMap);
  if (second && (second.kind === "threshold" || second.kind === "value" || second.kind === "set")) {
    return [condition, second];
  }

  return [{ kind: "partial", matched: condition, unmatchedText: residue.join(" "), term: clause.trim() }];
}

// A3 Level 1: the engine only ever counts or shares rows (fillPlan.js has no
// average/sum/group-by math), but "average"/"sum"/"per X"/"by X" leftover
// words used to fall through to resolveCondition and get reported as an
// undefined clinical term ("add a Definitions row for 'average'") — dishonest,
// since no Definitions row could ever satisfy it. Recognize the residue as an
// unsupported-capability request instead, so it declines plainly and logs to
// the miss log (the real signal for what to build next in A3 Level 2).
// A leftover term counts as such residue when it IS the bare aggregation word
// (nothing else left to resolve) or opens with a group-by marker ("per
// diagnosis", "by service", "grouped by clinic") — checked as a prefix so a
// genuine undefined term that merely contains "by" mid-sentence (e.g.
// "confirmed by biopsy") is not swept up by mistake.
function isUnsupportedAggregationResidue(term) {
  const t = String(term || "").trim();
  if (!t) return false;
  const bareIntent = detectIntent(t);
  if (
    bareIntent && (bareIntent.intent === "average" || bareIntent.intent === "sum")
    && words(t).length === words(bareIntent.phrase).length
  ) {
    return true;
  }
  const lower = t.toLowerCase();
  return GROUP_WORDS.some((g) => lower === g || lower.startsWith(`${g} `));
}

// Phase 7.5: cue words that mark a "summarize these columns" request. Stripped
// before the remaining fragments are read as a column list.
const TABLE1_STRIP = [
  "table 1", "table one", "baseline characteristics", "descriptive statistics",
  "descriptive stats", "summarize", "summarise", "summary of", "summary",
  "describe", "description of", "profile of", "overview of",
];

// Pull the columns named in a Table-1 request. Splits on commas / "and" / "&",
// strips cue words, and resolves each fragment to a real column — EXACT or
// contained header, or a NON-stretched concept hit only (a stretch would need a
// confirm chip, out of scope for the proactive Table-1 offer). Returns the
// resolved columns (in order, deduped) plus whether every meaningful fragment
// resolved and how many there were, so the caller can tell a clean column list
// from a filter question that merely mentions a column.
function table1Columns(request, headers, opts) {
  let t = ` ${String(request).toLowerCase()} `;
  for (const cue of TABLE1_STRIP) {
    t = t.replace(new RegExp(`\\b${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  }
  const frags = t.split(/,|\band\b|&|\bplus\b/i).map((s) => s.trim()).filter(Boolean);
  const columns = [];
  let resolved = 0;
  let meaningful = 0;
  for (const f of frags) {
    const phrase = termWords(f).join(" ");
    if (!phrase) continue; // a pure-filler fragment doesn't count for or against
    meaningful += 1;
    let col = fuzzyColumn(phrase, headers) || fuzzyColumn(termWords(f).map(singularize).join(" "), headers);
    if (!col) {
      const ref = resolveColumnRef(phrase, headers, opts);
      if (ref && !ref.stretched) col = ref.column;
    }
    if (col) {
      resolved += 1;
      if (!columns.includes(col)) columns.push(col);
    }
  }
  return { columns, allResolved: meaningful > 0 && resolved === meaningful, fragCount: meaningful };
}

// Phase 7.5: is this a Table-1 request? Two triggers: a describe/summarize cue
// naming 2+ columns, OR a bare column list (no operation, no filter) of 2+
// columns. A cohort/group-by/filtered request is never a Table-1.
function detectTable1(request, intent, cohort, groupBy, headers, opts) {
  if (cohort || groupBy) return null;
  const describe = Boolean(intent && intent.intent === "describe");
  if (intent && !describe) return null; // some other operation was asked for
  const { columns, allResolved, fragCount } = table1Columns(request, headers, opts);
  if (columns.length < 2) return null;
  if (!describe && !(allResolved && fragCount >= 2)) return null;
  return { columns };
}

export function describeLookedForTable1(columns) {
  const list = columns.length <= 1
    ? columns.map((c) => `"${c}"`).join("")
    : columns.slice(0, -1).map((c) => `"${c}"`).join(", ") + ` and "${columns[columns.length - 1]}"`;
  return `Building a Table 1 summarizing ${list} — n (%) for categories, median (IQR) and mean (SD) for numbers.`;
}

// Pull the base cohort clause out ("of patients with pyelonephritis"). Returns
// { term, start, end } describing the term phrase and where the whole clause sits
// in the original text, or null.
function extractCohort(request) {
  const lower = request.toLowerCase();
  let best = null;
  for (const marker of COHORT_MARKERS) {
    // Honesty bug 3 (2026-07-10): require a word boundary after the marker so
    // "patients with" cannot match inside "patients withOUT" and swallow the
    // negation — that inverted "how many patients without UTI".
    const re = new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "i");
    const m = re.exec(lower);
    const idx = m ? m.index : -1;
    if (idx !== -1 && (!best || idx < best.markerIdx || (idx === best.markerIdx && marker.length > best.marker.length))) {
      best = { marker, markerIdx: idx };
    }
  }
  if (!best) return null;
  const afterIdx = best.markerIdx + best.marker.length;
  const rest = request.slice(afterIdx);
  // The cohort term ends at the first comma or the next "how many" clause.
  const stop = rest.search(/,|\bhow many\b|\bhow much\b/i);
  const termText = stop === -1 ? rest : rest.slice(0, stop);
  return { termText, start: best.markerIdx, end: afterIdx + (stop === -1 ? rest.length : stop) };
}

// P1-2 (R4): a trailing "for <value>" / "in <value>" (or "with"/"among") that
// names a REAL cell value is a cohort filter, not part of an aggregation target:
// "average duration for UTI" means average Duration_days over the UTI rows, not a
// column called "duration uti". Only fires when the trailing phrase is an EXACT
// existing cell value — we never invent a cohort from a phrase the data doesn't
// contain (the never-guess promise). Returns a cohort {termText, start, end}
// shaped exactly like extractCohort's, or null. Tries the rightmost marker first
// so the closest trailing clause wins.
// P6-4: also reused by textToChart.js's histogram signal, so a plain-column
// chart request ("durations chosen for cystitis") gets the same cohort-clause
// parsing Step 3's Q&A already has — one brain, not a second implementation.
export function detectTrailingValueCohort(text, headers, index) {
  const markers = [...String(text).matchAll(/\b(?:for|in|with|among)\s+/gi)];
  for (let i = markers.length - 1; i >= 0; i--) {
    const mk = markers[i];
    const after = text.slice(mk.index + mk[0].length);
    // Tolerate a trailing entity noun ("for UTI patients", "in UTI cases").
    const termText = after.replace(/\s+(?:patients?|cases?|rows?|encounters?|records?|people)\s*$/i, "").trim();
    const phrase = termWords(termText).join(" ");
    if (!phrase) continue;
    const cands = findValueCandidates(phrase, headers, index);
    if (cands.some((c) => c.exact)) {
      return { termText, start: mk.index, end: text.length };
    }
  }
  return null;
}

// Detect a per-entity question over repeating rows (grain). If the user asks
// "how many patients…" and the patient column really does repeat, a row-mode
// count would double-count — so we flag it for a clarifying question.
function detectGrain(request, sheet, headers) {
  const w = new Set(words(request));
  const entities = ["patient", "patients", "person", "people", "prescriber", "prescribers"];
  const asked = entities.find((e) => w.has(e));
  if (!asked) return null;
  const singular = asked.replace(/s$/, "");
  let col = headers.find((h) => columnKey(h.name).includes(singular) || columnKey(h.name).includes(singular + "id"));

  // NEW-4: the file's per-entity key is often not named after the entity at
  // all (e.g. an encounter ID "CSN" when the question asks about patients).
  // Fall back to any ID-like column (almost every value unique) that still
  // has at least one repeat — the same "ID-like" heuristic scan.js uses for
  // findDuplicateIds — rather than silently assuming the row grain is right.
  if (!col) {
    for (const h of headers) {
      const vals = sheet.rows.map((r) => r[h.name]).filter((v) => v != null && String(v).trim() !== "");
      if (vals.length < 4) continue;
      const distinctCount = new Set(vals.map(foldKey)).size;
      if (distinctCount / vals.length < 0.9) continue; // not ID-like enough
      if (distinctCount === vals.length) continue; // no repeats — no grain issue
      col = h;
      break;
    }
  }
  if (!col) return null;
  const seen = new Set();
  let repeats = false;
  for (const r of sheet.rows) {
    const v = r[col.name];
    if (v == null) continue;
    const k = foldKey(v);
    if (seen.has(k)) { repeats = true; break; }
    seen.add(k);
  }
  if (!repeats) return null;
  return {
    entityColumn: col.name,
    entity: singular,
    question: `Each ${singular} appears on more than one row in "${col.name}". Should I combine each ${singular}'s rows first, then count who meets what you asked? Otherwise I would count rows, not ${asked}.`,
  };
}

// W2d: if any resolved stage is a stretch (abbreviation, prefix/token-subset
// value match, fuzzy column scope, or a tie between candidates), return a
// "needs_confirm" result the UI turns into a "Did you mean…?" box. The first
// stretched stage is the one to confirm; its `candidates` (already the top 2–3)
// become the answer buttons, and `phrase` is the exact wording the user typed
// so the confirmed choice can be remembered against it. An exact, single,
// unstretched match returns null → answer immediately.
// Strip the W2-only annotation fields (stretched/candidates/via/scopeWords) off
// a resolved condition once it's confirmed, so the executed plan and its
// serialized transform stay byte-for-byte what they were before W2 — the
// execution surfaces only ever read kind/column/op/value/values/when.
function cleanCondition(c) {
  // `negated` and the flipped op are NOT stripped — they are semantic, not
  // annotation; execution and the worker transform key off them.
  const { stretched, candidates, allCandidates, via, scopeWords, negWords, colStretch, colPhrase, ...rest } = c;
  void stretched; void candidates; void allCandidates; void via; void scopeWords; void negWords; void colStretch; void colPhrase;
  return rest;
}
function cleanStages(stages) {
  return stages.map((s) => ({ ...s, condition: cleanCondition(s.condition) }));
}

// A "did you mean this COLUMN?" confirmation — Phase 3's stretch chip for an
// aggregation target, group-by, or threshold column resolved by concept rather
// than by an exact header name. Candidates carry kind:"column" so the UI and
// the alias store treat them as a column mapping, never a cell value.
// Phase 5: `allCandidates`, when the caller has a fuller list than the round-1
// `candidates`, rides alongside on the needs_confirm result — the "None of
// these" refinement loop's starting pool. Falls back to `candidates` when a
// call site has no fuller list (e.g. a single unambiguous stretch).
function columnConfirm(phrase, candidates, via, request, allCandidates) {
  const mapCands = (list) => (list || []).map((x) => ({ kind: "column", column: x.column, via: x.via }));
  const cands = mapCands(candidates);
  const allCands = allCandidates && allCandidates.length ? mapCands(allCandidates) : cands;
  return {
    status: "needs_confirm",
    phrase,
    candidates: cands,
    allCandidates: allCands,
    via: via || null,
    request,
  };
}

function buildConfirmation(stages, request) {
  const stretchedStage = stages.find((s) => s.condition.stretched);
  if (!stretchedStage) return null;
  const c = stretchedStage.condition;
  // A threshold/column stretch confirms the COLUMN; a value stretch confirms the
  // cell value. They render and remember differently, so tag which one it is.
  if (c.colStretch) {
    return columnConfirm(c.colPhrase || c.term, c.candidates, c.via, request, c.allCandidates);
  }
  const candidates = (c.candidates && c.candidates.length ? c.candidates : [{ column: c.column, value: c.value }])
    .map((x) => ({ column: x.column, value: x.value }));
  const allCandidatesRaw = c.allCandidates && c.allCandidates.length
    ? c.allCandidates
    : (c.candidates && c.candidates.length ? c.candidates : [{ column: c.column, value: c.value }]);
  const allCandidates = allCandidatesRaw.map((x) => ({ column: x.column, value: x.value }));
  return {
    status: "needs_confirm",
    phrase: c.term,
    candidates,
    allCandidates,
    via: c.via || null,
    request,
  };
}

// P1-1: build a "list matching rows" match. Reuses the same cohort/level
// filter machinery a count uses (executeCohort returns the matched rows in row
// mode), then attaches an optional ORDER on a resolved column. Returns a
// confident list match, a needs_confirm/needs_definitions/partial when the
// filter needs one, or null when there is nothing to filter on and no sort (the
// caller then declines plainly). Grain memory is honored if a per-entity choice
// was already made for this file, but a fresh list never pops the count-centric
// "combine each patient's rows?" question — a list of rows is unambiguous.
function matchList(request, sortRaw, sheet, headers, index, defs, aliasMap, options) {
  // `request` already has any sort clause removed (matchRequest excises it
  // before intent detection); `sortRaw` carries the parsed ordering.
  const filterText = request;

  const cohort = extractCohort(filterText);
  let remainder = filterText;
  if (cohort) remainder = (filterText.slice(0, cohort.start) + " " + filterText.slice(cohort.end)).trim();
  const levelTexts = splitNestedLevels(remainder).filter((t) => termWords(t).length > 0);

  const rawStages = [];
  if (cohort) rawStages.push({ text: cohort.termText, role: "cohort" });
  for (const t of levelTexts) rawStages.push({ text: t, role: "level" });

  const stages = rawStages
    .flatMap((s) => resolveConditions(s.text, sheet, headers, index, defs, aliasMap).map((condition) => ({ ...s, condition })))
    .filter((s) => s.condition);

  // Resolve the sort column, if one was named. An unresolved named column is a
  // stretch → confirm before listing; a bare direction with no column just
  // lists in natural order (sort dropped).
  let sort = null;
  if (sortRaw && sortRaw.columnPhrase) {
    const col = fuzzyColumn(sortRaw.columnPhrase, headers);
    if (col) {
      sort = { column: col, direction: sortRaw.direction };
    } else {
      const ref = resolveColumnRef(sortRaw.columnPhrase, headers, { aliasMap, index });
      if (ref && !ref.stretched) sort = { column: ref.column, direction: sortRaw.direction };
      else if (ref && ref.stretched) return columnConfirm(sortRaw.columnPhrase, ref.candidates, ref.via, request, ref.allCandidates);
      // else: named column can't be resolved — drop the sort rather than guess.
    }
  }

  const hasCondition = stages.some((s) => ["value", "set", "threshold", "blank"].includes(s.condition.kind));
  // Nothing to filter on and no sort — not a list we can honestly build.
  if (!hasCondition && !sort) return null;

  // A term we could not place blocks/asks, exactly like a count would.
  const partial = stages.find((s) => s.condition.kind === "partial");
  if (partial) {
    return { status: "partial", understood: partial.condition.matched, unmatchedText: partial.condition.unmatchedText, clause: partial.condition.term, request };
  }
  const missing = stages.filter((s) => s.condition.kind === "missing").map((s) => s.condition);
  if (missing.length) {
    return { status: "needs_definitions", missingTerms: missing, definitionsPresent: Boolean(defs?.present), request };
  }
  const confirm = buildConfirmation(stages, request);
  if (confirm) return confirm;

  // Grain: honor a remembered per-entity choice (list one row per entity), but
  // never ask fresh — a list of rows doesn't need the count-mode question.
  const grain = detectGrain(request, sheet, headers);
  let grainMode = options.grainMode || null;
  let grainFromMemory = false;
  if (grain && !grainMode && options.grainChoices && options.grainChoices[grain.entityColumn]) {
    grainMode = options.grainChoices[grain.entityColumn];
    grainFromMemory = true;
  }

  const cleanedStages = cleanStages(stages);
  return {
    status: "confident",
    intent: "list",
    list: { sort },
    stages: cleanedStages,
    grainMode: grainMode === "group-then-test" ? "group-then-test" : "row",
    grain: grainMode === "group-then-test" ? grain : null,
    grainFromMemory,
    grainEntity: grain?.entityColumn || null,
    lookedFor: describeLookedForList(cleanedStages, sort, grainMode === "group-then-test" ? grain : null),
    sheetName: sheet.name,
  };
}

// P1-1: the trust line for a row list — "Listing the rows where …, sorted by …".
export function describeLookedForList(stages, sort, grain) {
  const unit = grain ? `${grain.entity}s` : "rows";
  let base;
  if (!stages.length) base = `Listing all ${unit}`;
  else base = `Listing the ${unit} where ${stages.map((s) => conditionPhrase(s.condition)).join(", and ")}`;
  if (sort) {
    const dirWord = sort.direction === "desc" ? "high to low" : "low to high";
    base += `, sorted by "${sort.column}" (${dirWord})`;
  }
  return `${base}.`;
}

// Public: read a request. options.grainMode = "row" | "group-then-test" | null.
// Returns a result whose `status` drives the UI:
//   "none"             — nothing recognizable; offer Claude / decline, log a miss
//   "needs_definitions"— a clinical term is undefined; block and ask for it
//   "needs_confirm"    — the app stretched to reach a value; confirm before answering
//   "grain"            — per-entity question over repeating rows; ask to combine
//   "confident"        — understood; run it, but always show `lookedFor`
export function matchRequest(request, workbook, defs, options = {}) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet) return { status: "none", reason: "no-data" };
  // P1-1: note whether the user asked to SEE rows ("show me…", "list…",
  // "sort the rows…") BEFORE the list verbs are stripped below — a counting or
  // aggregation intent still wins, but otherwise this becomes a row list.
  const listLed = detectListVerb(request);
  // P0-1: peel leading request verbs ("show me all", "list all") so they are
  // never mistaken for an undefined clinical term. Everything below reads the
  // cleaned request.
  request = stripRequestLead(request);
  // P1-1: for a list request, set aside any trailing sort clause ("… highest
  // first", "sorted by X") BEFORE intent detection, so an ordering word like
  // "highest" is never read as a max/min aggregation. The clause is handed to
  // matchList to become an ORDER on the result.
  let listSort = null;
  if (listLed) {
    listSort = parseSortModifier(request);
    if (listSort && listSort.matchText) {
      request = request.replace(listSort.matchText, " ").replace(/\s+/g, " ").trim();
    }
  }
  const headers = sheet.headers;
  const index = valueIndex(sheet);
  // W2d: phrase (folded) -> confirmed { column, value } from an earlier "Did you
  // mean…?" answer this session, so the same stretch never asks twice. Passed
  // in by runOffline from App-level session state.
  const aliasMap = options.aliasMap instanceof Map
    ? new Map(options.aliasMap)
    : new Map(Object.entries(options.aliasMap || {}));

  // Phase 3: fold the persistent, per-file learned COLUMN aliases in on top of
  // the session map (as column-type entries), so a phrase the owner confirmed in
  // an earlier session ("treatment length" -> Duration_days) is an exact hit now
  // with no chip. Cell-value aliases are never persisted (privacy), so only
  // column entries arrive here.
  for (const [k, col] of Object.entries(options.columnAliases || {})) {
    if (!aliasMap.has(k) && col) aliasMap.set(k, { kind: "column", column: col });
  }

  // Phase 4: the most-common/top-N ranking family is checked first, ahead of
  // every other intent — its trigger words ("most common", "top 5", "longest")
  // never overlap the other intents' phrases (see synonyms.js), and it does
  // not compose with a "per X" breakdown or nested "of those" levels (out of
  // scope for this phase), so it resolves against the raw request directly.
  const topN = detectTopN(request);
  // P1-4a: "combine X and Y and rank the types" / "rank everything in X and Y
  // together" names no "most common"/"top N" phrase, just a bare "rank" verb
  // — only meaningful here alongside a pooled-columns cue, so it never widens
  // plain single-column detection (matchTopN still requires the real phrases).
  const bareRank = !topN && /\brank(ing|ed)?\b/i.test(request);
  const pooledTopInfo = topN && topN.family === "frequency" ? topN : bareRank ? { family: "frequency", direction: "most", n: null } : null;
  if (pooledTopInfo) {
    const pooledColumns = detectPooledColumns(request, headers, { aliasMap, index });
    if (pooledColumns) return matchPooledRank(request, pooledTopInfo, pooledColumns, sheet, headers, index, defs, aliasMap, options);
  }
  if (topN) return matchTopN(request, topN, sheet, headers, index, defs, aliasMap);

  const intent = detectIntent(request);

  // P1-1: a row-listing request ("show me all patients who got cephalexin",
  // "sort the rows by visit date newest first"). Only when a list verb led AND
  // no counting/aggregation/ranking intent claimed it — those all resolve
  // above/below and win. Handled here, before the group-by step, so a sort
  // clause's "by <column>" is never mistaken for a "per <column>" breakdown.
  if (listLed && !intent) {
    const listMatch = matchList(request, listSort, sheet, headers, index, defs, aliasMap, options);
    if (listMatch) return listMatch;
    // Fell through (nothing to filter on and no sort) — treat as unrecognized so
    // it declines with the plain capability message, never a bad guess.
    return { status: "none", reason: "unrecognized", request };
  }

  // A3 Level 2: resolve a "per X"/"by X"/"grouped by X" breakdown column
  // first, against the raw request, and strip its clause out before looking
  // for a cohort clause. A cohort clause is greedy (everything up to a comma
  // or "how many"), so resolving it first would swallow a trailing group-by
  // phrase as if it were part of the filter term (e.g. "of patients with UTI
  // per drug" would otherwise read "UTI per drug" as one filter phrase).
  const groupBy = resolveGroupBy(request, headers, { aliasMap, index });
  // Phase 3: a group-by column reached by concept ("per condition" -> Diagnosis)
  // is a stretch — confirm the column before breaking the answer down by it.
  if (groupBy && groupBy.stretched) {
    return columnConfirm(groupBy.phrase, groupBy.candidates, groupBy.via, request, groupBy.allCandidates);
  }
  const preCohortText = groupBy ? (request.slice(0, groupBy.start) + " " + request.slice(groupBy.end)).trim() : request;
  const cohort = extractCohort(preCohortText);

  // Phase 7.5: a Table-1 request ("summarize diagnosis, drug and duration", or a
  // bare list of 2+ columns) is intercepted before the single-column describe /
  // aggregation handling, since it names several columns and no single target.
  const table1 = detectTable1(request, intent, cohort, groupBy, headers, { aliasMap, index });
  if (table1) {
    return {
      status: "confident",
      intent: "table1",
      table1: { columns: table1.columns },
      stages: [],
      grainMode: "row",
      lookedFor: describeLookedForTable1(table1.columns),
      sheetName: sheet.name,
    };
  }

  // A3 Level 2 / Phase 2: average/sum/distinct/median/quartiles/stdev/min/max/
  // range/describe try to resolve a real numeric/target column before anything
  // else. Only decline outright (as Level 1 did) when no column can be pinned
  // down — a genuinely unresolvable aggregation request still gets the honest
  // capability message, but "average duration_days [for patients with X] [per
  // Y]" now actually computes.
  if (intent && AGGREGATION_INTENTS.has(intent.intent)) {
    // P1-2 (R4): if no cohort marker was found, a trailing "for/in <value>" that
    // names a real cell value is still a cohort filter — peel it off so it does
    // not get glued onto the target phrase ("average duration for UTI").
    const aggCohort = cohort || detectTrailingValueCohort(preCohortText, headers, index);
    // Search for the target column with any cohort clause ("for patients with
    // UTI") stripped out too, so its words don't get glued onto the target
    // phrase and break the fuzzy column match.
    const targetSearchText = aggCohort ? (preCohortText.slice(0, aggCohort.start) + " " + preCohortText.slice(aggCohort.end)).trim() : preCohortText;
    // A distinct count works on any column type; every other aggregation
    // (including describe) needs a real numeric column.
    const numericOnly = intent.intent !== "distinct";
    const targetRef = resolveAggregationTarget(targetSearchText, intent.phrase, headers, { aliasMap, index, numericOnly });
    if (!targetRef) {
      return { status: "none", reason: `unsupported-${intent.intent}`, request };
    }
    // Phase 3: a target reached by concept ("average treatment length" ->
    // Duration_days) is a stretch — confirm the column, then compute on re-run.
    if (targetRef.stretched) {
      return columnConfirm(targetRef.phrase || targetSearchText.trim(), targetRef.candidates, targetRef.via, request, targetRef.allCandidates);
    }
    return matchAggregation(request, intent, targetRef.column, aggCohort, groupBy, sheet, headers, index, defs, aliasMap);
  }

  // A cohort question needs either a counting word ("how many", "what share")
  // or a cohort marker ("of patients with…"). Without one of those this is not
  // our kind of request — decline rather than treat stray words as filters.
  if (!intent && !cohort) {
    return { status: "none", reason: "unrecognized", request };
  }

  // Build the remainder after removing the cohort clause, then split into levels.
  let remainder = preCohortText;
  if (cohort) remainder = (preCohortText.slice(0, cohort.start) + " " + preCohortText.slice(cohort.end)).trim();

  const levelTexts = splitNestedLevels(remainder).filter((t) => termWords(t).length > 0);

  // Assemble the ordered filter stages: cohort base first, then each level.
  const rawStages = [];
  if (cohort) rawStages.push({ text: cohort.termText, role: "cohort" });
  for (const t of levelTexts) rawStages.push({ text: t, role: "level" });

  // With no intent, no cohort, no group-by and no stages, this is not our kind of request.
  if (!intent && !cohort && !groupBy && rawStages.length === 0) {
    return { status: "none", reason: "unrecognized", request };
  }

  const stages = rawStages
    .flatMap((s) => resolveConditions(s.text, sheet, headers, index, defs, aliasMap).map((condition) => ({ ...s, condition })))
    .filter((s) => s.condition); // drop stages that were pure filler

  const partial = stages.find((s) => s.condition.kind === "partial");
  if (partial) {
    return {
      status: "partial",
      understood: partial.condition.matched,
      unmatchedText: partial.condition.unmatchedText,
      clause: partial.condition.term,
      request,
    };
  }

  const missing = stages.filter((s) => s.condition.kind === "missing").map((s) => s.condition);
  if (missing.length) {
    // A3 Level 1: if every unresolved term is a group-by residue ("per
    // diagnosis", "by service") rather than a genuine undefined clinical
    // term, this is a capability gap, not a missing definition — decline
    // honestly instead of asking for a Definitions row that could never help.
    if (missing.every((m) => m.reason === "unknown" && isUnsupportedAggregationResidue(m.term))) {
      return { status: "none", reason: "unsupported-groupby", request };
    }
    return {
      status: "needs_definitions",
      missingTerms: missing,
      definitionsPresent: Boolean(defs?.present),
      request,
    };
  }

  if (stages.length === 0 && !groupBy) {
    // We caught an intent word but could not pin down what to filter on.
    return { status: "none", reason: "no-conditions", request };
  }

  // W2d middle path: if the app had to STRETCH to reach any value (an
  // abbreviation, a prefix/token-subset match, a column-scope fuzzy match, or
  // more than one equally-strong candidate), confirm before answering.
  const confirm = buildConfirmation(stages, request);
  if (confirm) return confirm;

  // A group-by breakdown counts rows per group directly; the per-patient grain
  // question ("combine each patient's rows first?") is about a plain count,
  // not a breakdown, so skip it once a group-by has already been resolved.
  const grain = groupBy ? null : detectGrain(request, sheet, headers);
  let grainMode = options.grainMode || null;
  // Phase 7.7: grain memory — a remembered choice for this entity column (from a
  // previous ask on this file shape) is applied instead of asking again.
  let grainFromMemory = false;
  if (grain && !grainMode && options.grainChoices && options.grainChoices[grain.entityColumn]) {
    grainMode = options.grainChoices[grain.entityColumn];
    grainFromMemory = true;
  }
  if (grain && !grainMode) {
    return { status: "grain", grain, request };
  }

  const cleanedStages = cleanStages(stages);
  return {
    status: "confident",
    intent: intent?.intent || "count",
    stages: cleanedStages,
    groupColumn: groupBy?.column || null,
    grain: grainMode === "group-then-test" ? grain : null,
    grainMode: grainMode || "row",
    // Phase 7.7: surfaced so the UI can show a small "counting per patient —
    // change" note when the answer used a remembered grain, not a fresh ask.
    grainFromMemory,
    grainEntity: grain?.entityColumn || null,
    lookedFor: describeLookedFor(cleanedStages, intent, grainMode, grain, groupBy),
    sheetName: sheet.name,
  };
}

// A3 Level 2: resolve an average/sum/distinct request once a target column is
// pinned down. Reuses the same cohort/filter machinery a plain count uses —
// nested "of those" nesting is out of scope for an aggregation, so only the
// cohort clause (if any) becomes a filter stage.
function matchAggregation(request, intent, targetColumn, cohort, groupBy, sheet, headers, index, defs, aliasMap) {
  // Honesty bug 1 (2026-07-10): averaging/summing a text column used to
  // "work" — "average age" confidently answered 'Averaging "Diagnosis"'.
  // Gate on the column's inferred type: words are not numbers, so refuse with
  // a plain message instead of computing nonsense. "mixed" columns still pass
  // (toNumber skips their unreadable cells and says so); a distinct count
  // works on any type.
  if (intent.intent !== "distinct") {
    const h = headers.find((x) => x.name === targetColumn);
    if (h && h.type && !NUMERIC_COLUMN_TYPES.has(h.type)) {
      return { status: "none", reason: "non-numeric-target", targetColumn, aggIntent: intent.intent, request };
    }
  }
  const rawStages = [];
  if (cohort) rawStages.push({ text: cohort.termText, role: "cohort" });

  const stages = rawStages
    .flatMap((s) => resolveConditions(s.text, sheet, headers, index, defs, aliasMap).map((condition) => ({ ...s, condition })))
    .filter((s) => s.condition);

  const partial = stages.find((s) => s.condition.kind === "partial");
  if (partial) {
    return {
      status: "partial",
      understood: partial.condition.matched,
      unmatchedText: partial.condition.unmatchedText,
      clause: partial.condition.term,
      request,
    };
  }

  const missing = stages.filter((s) => s.condition.kind === "missing").map((s) => s.condition);
  if (missing.length) {
    return {
      status: "needs_definitions",
      missingTerms: missing,
      definitionsPresent: Boolean(defs?.present),
      request,
    };
  }

  const confirm = buildConfirmation(stages, request);
  if (confirm) return confirm;

  const cleanedStages = cleanStages(stages);
  return {
    status: "confident",
    intent: intent.intent,
    aggregation: { targetColumn, groupColumn: groupBy?.column || null },
    stages: cleanedStages,
    grainMode: "row",
    lookedFor: describeLookedForAggregation(intent.intent, targetColumn, cleanedStages, groupBy),
    sheetName: sheet.name,
  };
}

// Phase 4: the default cap when no "top N" count was stated. Frequency
// ranking's default is "the full ranked table" (no cap) — it mirrors the
// existing "per X" breakdown, which always shows every group, and a
// clinical file usually has few distinct values (diagnoses, drugs) so the
// full list is short and useful. Magnitude ranking's default is 1 — it ranks
// raw ROWS, which can number in the thousands, so "longest duration" with no
// count means "the single longest", not a full re-sort of the sheet.
const DEFAULT_TOPN = { frequency: Infinity, magnitude: 1 };

// Phase 4: resolve a most-common/top-N ranking request once a target column
// is pinned down. Reuses the same cohort-filter machinery average/sum/etc.
// use — only the base cohort clause becomes a filter stage, same scope as
// matchAggregation (nested "of those" levels are out of scope for a ranking).
function matchTopN(request, topInfo, sheet, headers, index, defs, aliasMap) {
  const cohort = extractCohort(request);
  const targetSearchText = cohort ? (request.slice(0, cohort.start) + " " + request.slice(cohort.end)).trim() : request;
  const targetRef = resolveTopNTarget(targetSearchText, topInfo, headers, { aliasMap, index });
  if (!targetRef) return { status: "none", reason: "unsupported-topn", request };
  if (targetRef.stretched) {
    return columnConfirm(targetRef.phrase || targetSearchText.trim(), targetRef.candidates, targetRef.via, request);
  }

  const family = topInfo.family;
  // Phase 1's honesty gate: "longest"/"shortest" rank a column's raw values by
  // magnitude, which only makes sense for numbers. "most common"/"top N" rank
  // by frequency, which works on any column type (like a distinct count), so
  // no gate applies there.
  if (family === "magnitude") {
    const h = headers.find((x) => x.name === targetRef.column);
    if (h && h.type && !NUMERIC_COLUMN_TYPES.has(h.type)) {
      return { status: "none", reason: "non-numeric-target", targetColumn: targetRef.column, aggIntent: "topN-magnitude", request };
    }
  }

  const rawStages = [];
  if (cohort) rawStages.push({ text: cohort.termText, role: "cohort" });
  const stages = rawStages
    .flatMap((s) => resolveConditions(s.text, sheet, headers, index, defs, aliasMap).map((condition) => ({ ...s, condition })))
    .filter((s) => s.condition);

  const partial = stages.find((s) => s.condition.kind === "partial");
  if (partial) {
    return {
      status: "partial",
      understood: partial.condition.matched,
      unmatchedText: partial.condition.unmatchedText,
      clause: partial.condition.term,
      request,
    };
  }

  const missing = stages.filter((s) => s.condition.kind === "missing").map((s) => s.condition);
  if (missing.length) {
    return {
      status: "needs_definitions",
      missingTerms: missing,
      definitionsPresent: Boolean(defs?.present),
      request,
    };
  }

  const confirm = buildConfirmation(stages, request);
  if (confirm) return confirm;

  const n = topInfo.n != null ? topInfo.n : DEFAULT_TOPN[family];
  const cleanedStages = cleanStages(stages);
  const topN = { targetColumn: targetRef.column, direction: topInfo.direction, n, family };
  return {
    status: "confident",
    intent: "topN",
    topN,
    stages: cleanedStages,
    grainMode: "row",
    lookedFor: describeLookedForTopN(topN, cleanedStages),
    sheetName: sheet.name,
  };
}

// P1-4a (2026-07-16): cue words that ask 2+ named columns to be POOLED into one
// tally, rather than each ranked separately — "most common values across
// Primary Dx and Secondary Dx", "combine Primary and Secondary and rank the
// types", "rank everything in X and Y together". Deliberately narrow (a
// specific word, not a bare "and") so an ordinary two-column mention never
// misfires into pooling.
const POOLED_CUES = ["across", "combine", "combined with", "pooled", "pool", "together"];

// Pull 2+ column names out of the pooled-cue segment of the request, reusing
// the same fragment-split + resolve machinery table1Columns uses for its
// column list (comma / "and" / "&" separated, EXACT/contained header or a
// non-stretched concept hit only — a stretch here would need its own confirm
// chip, out of scope for this phase). Returns the resolved columns in order,
// deduped, or null if fewer than 2 resolved.
function detectPooledColumns(request, headers, opts) {
  const t = ` ${String(request || "").toLowerCase()} `;
  let cueIdx = -1;
  let cueLen = 0;
  for (const cue of POOLED_CUES) {
    const re = new RegExp(`\\b${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const m = re.exec(t);
    if (m && (cueIdx === -1 || m.index < cueIdx)) { cueIdx = m.index; cueLen = m[0].length; }
  }
  if (cueIdx === -1) return null;
  let seg = t.slice(cueIdx + cueLen);
  // "and rank the types together" / "and rank them" trails the column list —
  // cut it off so it never gets read as a third fragment.
  seg = seg.replace(/\band rank\b.*$/i, "").replace(/\btogether\b/gi, "");
  const frags = seg.split(/,|\band\b|&/i).map((s) => s.trim()).filter(Boolean);
  const columns = [];
  for (const f of frags) {
    const phrase = termWords(f).join(" ");
    if (!phrase) continue;
    let col = fuzzyColumn(phrase, headers) || fuzzyColumn(termWords(f).map(singularize).join(" "), headers);
    if (!col) {
      const ref = resolveColumnRef(phrase, headers, opts);
      if (ref && !ref.stretched) col = ref.column;
    }
    if (col && !columns.includes(col)) columns.push(col);
  }
  return columns.length >= 2 ? columns : null;
}

// The same ID-like fallback heuristic detectGrain uses (scan.js's
// findDuplicateIds trick): a column that names the entity directly (patient,
// MRN, id), or failing that, any column that's almost-all-unique but still has
// at least one repeat. Needed for the "patient" counting policy's entityColumn.
function findPooledEntityColumn(sheet, headers) {
  let col = headers.find((h) => {
    const k = columnKey(h.name);
    return k.includes("patient") || k.includes("mrn") || k === "id" || k.endsWith("id");
  });
  if (!col) {
    for (const h of headers) {
      const vals = sheet.rows.map((r) => r[h.name]).filter((v) => v != null && String(v).trim() !== "");
      if (vals.length < 4) continue;
      const distinctCount = new Set(vals.map(foldKey)).size;
      if (distinctCount / vals.length < 0.9) continue;
      if (distinctCount === vals.length) continue;
      col = h;
      break;
    }
  }
  return col ? col.name : null;
}

// P1-4a: resolve a pooled multi-column ranking request. Mirrors matchTopN's
// shape (same cohort-stage machinery, same confirm/needs_definitions/partial
// gates) but ranks the POOLED columns via rankFrequencyPooled instead of a
// single column via rankFrequency. Only the "frequency" family applies — a
// magnitude pool ("longest across X and Y") isn't a coherent question, so
// matchRequest never calls this unless topInfo.family === "frequency".
//
// Counting policy (Decision D, owner-approved 2026-07-11) is asked once per
// file + column-pair and remembered (pooledPolicyStore.js, mirrors
// grainStore.js) — never silently defaulted, so `options.pooledPolicy` must
// be set (fresh answer) or `options.pooledPolicyChoices[poolKey]` must have a
// remembered one before this can return "confident"; otherwise it returns
// "needs_pooled_policy" with a suggested default for the UI to pre-select.
function matchPooledRank(request, topInfo, columns, sheet, headers, index, defs, aliasMap, options) {
  const cohort = extractCohort(request);
  const rawStages = [];
  if (cohort) rawStages.push({ text: cohort.termText, role: "cohort" });
  const stages = rawStages
    .flatMap((s) => resolveConditions(s.text, sheet, headers, index, defs, aliasMap).map((condition) => ({ ...s, condition })))
    .filter((s) => s.condition);

  const partial = stages.find((s) => s.condition.kind === "partial");
  if (partial) {
    return {
      status: "partial",
      understood: partial.condition.matched,
      unmatchedText: partial.condition.unmatchedText,
      clause: partial.condition.term,
      request,
    };
  }
  const missing = stages.filter((s) => s.condition.kind === "missing").map((s) => s.condition);
  if (missing.length) {
    return { status: "needs_definitions", missingTerms: missing, definitionsPresent: Boolean(defs?.present), request };
  }
  const confirm = buildConfirmation(stages, request);
  if (confirm) return confirm;

  const poolKey = columns.slice().sort().join("|");
  const remembered = options.pooledPolicyChoices && options.pooledPolicyChoices[poolKey];
  const policy = options.pooledPolicy || (remembered && remembered.policy) || null;
  if (!policy) {
    // Decision D's suggested default: patient-grain if this file's grain
    // memory already says per-patient, otherwise occurrence. A suggestion,
    // never applied silently — the caller still confirms it once.
    const grainEntity = findPooledEntityColumn(sheet, headers);
    const suggestedPolicy = grainEntity && options.grainChoices && options.grainChoices[grainEntity] === "group-then-test"
      ? "patient" : "occurrence";
    return { status: "needs_pooled_policy", columns, poolKey, suggestedPolicy, entityColumn: grainEntity, request };
  }
  const entityColumn = policy === "patient" ? ((remembered && remembered.entityColumn) || findPooledEntityColumn(sheet, headers)) : null;
  if (policy === "patient" && !entityColumn) {
    return { status: "none", reason: "no-entity-column-for-patient-policy", columns, request };
  }

  const n = topInfo.n != null ? topInfo.n : DEFAULT_TOPN.frequency;
  const cleanedStages = cleanStages(stages);
  const pooled = { columns, policy, n, direction: topInfo.direction, entityColumn };
  return {
    status: "confident",
    intent: "pooledRank",
    pooled,
    pooledPolicyFromMemory: Boolean(remembered && !options.pooledPolicy),
    stages: cleanedStages,
    grainMode: "row",
    lookedFor: describeLookedForPooled(pooled, cleanedStages),
    sheetName: sheet.name,
  };
}

export function conditionPhrase(c) {
  if (c.kind === "threshold") {
    // Phase 7.3: state the unit conversion in the trust line, so "more than a
    // week" reads back as "over 7 (from 'a week = 7 days')" — the approximation
    // is never hidden.
    const note = c.conversionNote ? ` (from "${c.conversionNote}")` : "";
    return `"${c.column}" is ${opWord(c.op)} ${c.value}${note}`;
  }
  if (c.kind === "blank") return `"${c.column}" is ${c.present ? "recorded (not blank)" : "missing (blank / N/A)"}`;
  if (c.kind === "set") return `"${c.column}" is ${c.op === "not-in" ? "NONE of" : "one of"} ${c.values.join(", ")}`;
  // Bug 3: a negated condition states the negation back plainly, so the user
  // sees the app understood the "not" before trusting the number.
  return `"${c.column}" is ${c.op === "<>" ? "NOT " : ""}${c.value}`;
}

function opWord(op) {
  return { ">=": "at least", "<=": "at most", ">": "over", "<": "under", "<>": "not", "=": "" }[op] || op;
}

// The trust panel line (build prompt §8, §12): spell the filters back so a wrong
// guess is visible before anyone trusts the number.
export function describeLookedFor(stages, intent, grainMode, grain, groupBy) {
  const who = grainMode === "group-then-test" && grain ? `${grain.entity}s (combining each one's rows first)` : "rows";
  const lead = intent?.intent === "proportion" ? `Finding the share of ${who}` : `Counting ${who}`;
  const parts = stages.map((s) => conditionPhrase(s.condition));
  const where = parts.length ? ` where ${parts.join(", then ")}` : "";
  const brokenDown = groupBy ? `, broken down by "${groupBy.column}"` : "";
  return `${lead}${where}${brokenDown}.`;
}

// A3 Level 2 / Phase 2: the trust panel line for an average/sum/distinct/
// descriptive-statistics request.
const AGG_VERB = {
  sum: "Adding up", average: "Averaging", distinct: "Counting the distinct values of",
  median: "Finding the median of", quartiles: "Finding the quartiles of",
  stdev: "Finding the standard deviation of", min: "Finding the minimum of",
  max: "Finding the maximum of", range: "Finding the range of",
  describe: "Describing",
};
export function describeLookedForAggregation(aggIntent, targetColumn, stages, groupBy) {
  const verb = AGG_VERB[aggIntent] || "Computing";
  const parts = stages.map((s) => conditionPhrase(s.condition));
  const where = parts.length ? ` where ${parts.join(", then ")}` : "";
  const brokenDown = groupBy ? `, broken down by "${groupBy.column}"` : "";
  return `${verb} "${targetColumn}"${where}${brokenDown}.`;
}

// Phase 4: the trust panel line for a most-common/top-N ranking request.
export function describeLookedForTopN(topN, stages) {
  const parts = stages.map((s) => conditionPhrase(s.condition));
  const where = parts.length ? ` where ${parts.join(", then ")}` : "";
  const cap = topN.n === Infinity ? "" : ` (top ${topN.n})`;
  if (topN.family === "magnitude") {
    const verb = topN.direction === "least" ? "smallest" : "largest";
    return `Ranking "${topN.targetColumn}" by value, ${verb} first${cap}${where}.`;
  }
  const verb = topN.direction === "least" ? "least common" : "most common";
  return `Ranking "${topN.targetColumn}" by how ${verb} each value is${cap}${where}.`;
}

// P1-4a: the trust panel line for a pooled multi-column ranking request.
export function describeLookedForPooled(pooled, stages) {
  const parts = stages.map((s) => conditionPhrase(s.condition));
  const where = parts.length ? ` where ${parts.join(", then ")}` : "";
  const cap = pooled.n === Infinity ? "" : ` (top ${pooled.n})`;
  const verb = pooled.direction === "least" ? "least common" : "most common";
  const cols = pooled.columns.map((c) => `"${c}"`).join(" + ");
  const policyNote = pooled.policy === "row" ? ", once per row"
    : pooled.policy === "patient" ? `, once per patient ("${pooled.entityColumn}")`
    : ", counting every occurrence";
  return `Pooling ${cols} and ranking by how ${verb} each value is${cap}${policyNote}${where}.`;
}
