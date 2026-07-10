// Shared word lists for the offline engine (build prompt §8). Everyday words the
// owner and their users actually type map onto a small set of intents and
// comparators. This is deliberately a plain lookup, not a grammar — anything it
// can't place with confidence goes to Claude or is declined (§3.5).

// --- intents ---------------------------------------------------------------
// Each intent lists the phrases that mean it. Longer phrases are checked first
// so "how many" wins over a stray "many".
// Phase 2 (2026-07-10): descriptive-statistics intents, alongside the original
// count/sum/average/distinct/proportion family. Deliberately NO bare 3-letter
// "min"/"max" phrases — a request like "patients under 5 min" uses "min" as a
// time unit, not a request for the minimum, and detectIntent's longest-phrase
// rule can't tell those apart on a short token; the false-positive risk (a
// threshold question wrongly read as an aggregation request) outweighs the
// convenience, per the "false positives worse than misses" rule from Phase 3.
export const INTENTS = {
  count: ["how many", "number of", "count of", "count", "tally", "total number"],
  sum: ["total", "sum of", "sum", "add up", "added up", "combined"],
  average: ["average", "mean", "typical", "avg"],
  distinct: ["how many different", "how many unique", "distinct", "unique", "different"],
  proportion: ["what share", "what proportion", "what percent", "percentage of", "percent of", "proportion of", "share of", "what fraction", "fraction of"],
  median: ["median"],
  quartiles: ["interquartile range", "quartiles", "quartile", "iqr"],
  stdev: ["standard deviation", "std dev", "stdev", "std. dev."],
  min: ["minimum", "lowest value", "smallest value", "lowest", "smallest"],
  max: ["maximum", "highest value", "largest value", "highest", "largest", "biggest"],
  range: ["range of", "range"],
  describe: ["descriptive statistics", "descriptive stats", "describe", "summarize", "summarise", "summary of"],
};

// Phase 2: the descriptive-statistics intents that need a resolved NUMERIC
// target column, same as average/sum always have. "distinct" and "describe"
// are handled separately (distinct works on any column type; describe gets
// its own numeric-only gate with its own decline wording).
export const NUMERIC_STAT_INTENTS = new Set(["sum", "average", "median", "quartiles", "stdev", "min", "max", "range"]);

// --- comparators -----------------------------------------------------------
// Order matters: multi-word phrases must be tried before single words so
// "at least" is not eaten by "least".
export const COMPARATORS = [
  { phrases: ["greater than or equal to", "at least", "or more", "or greater", "or higher", "no fewer than", "no less than", "minimum of"], op: ">=" },
  { phrases: ["less than or equal to", "at most", "or fewer", "or less", "or lower", "no more than", "up to", "maximum of"], op: "<=" },
  { phrases: ["greater than", "more than", "over", "above", "longer than", "exceeds", "exceeding"], op: ">" },
  { phrases: ["less than", "fewer than", "under", "below", "shorter than"], op: "<" },
  { phrases: ["is not", "are not", "not equal to", "other than", "except", "excluding", "apart from"], op: "<>" },
  { phrases: ["equal to", "equals", "exactly", "is", "are", "of"], op: "=" },
];

// Words that introduce a grouping ("per region", "by clinic", "for each ward").
export const GROUP_WORDS = ["per", "by", "for each", "each", "grouped by", "broken down by", "split by"];

// Words that start a nested follow-up level ("and of those, how many…").
export const NESTED_MARKERS = ["and of those", "of those", "of these", "and of these", "among those", "among them", "of whom"];

// Words that mark the base cohort ("of patients with…", "among patients who…").
export const COHORT_MARKERS = ["of patients with", "of patients who", "among patients with", "among patients who", "for patients with", "in patients with", "patients with", "patients who", "of people with", "people with"];

// W2b: a short, built-in table of everyday clinical shorthand -> the long forms
// that actually appear in lab/organism/drug columns. This lets "E. coli" find
// "ESCHERICHIA COLI" with no Definitions round-trip. It is deliberately small
// (~15 common bugs and their abbreviations) and only ever EXPANDS a phrase into
// candidate spellings — it never decides an answer on its own, and any answer
// reached through an expansion is always flagged as a stretch to confirm. The
// user's own Definitions editor remains the extension point for anything not
// here. Keys and values are folded loosely (case/spacing/punctuation) at lookup.
export const CLINICAL_SYNONYMS = {
  "e coli": ["escherichia coli"],
  "ecoli": ["escherichia coli"],
  "escherichia": ["escherichia coli"],
  "staph": ["staphylococcus", "staphylococcus aureus"],
  "staph aureus": ["staphylococcus aureus"],
  "mrsa": ["methicillin resistant staphylococcus aureus", "staphylococcus aureus"],
  "mssa": ["methicillin susceptible staphylococcus aureus", "staphylococcus aureus"],
  "strep": ["streptococcus"],
  "gbs": ["group b streptococcus", "streptococcus agalactiae"],
  "vre": ["vancomycin resistant enterococcus", "enterococcus"],
  "esbl": ["extended spectrum beta lactamase"],
  "klebs": ["klebsiella", "klebsiella pneumoniae"],
  "pseudomonas": ["pseudomonas aeruginosa"],
  "psa": ["pseudomonas aeruginosa"],
  "c diff": ["clostridioides difficile", "clostridium difficile"],
  "cdiff": ["clostridioides difficile", "clostridium difficile"],
};

// Fold a term the same loose way the synonym table keys are written, so
// "E. coli", "E.Coli" and "e  coli" all reach the "e coli" key.
function foldSynonymKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// W2b: return the long-form spellings a shorthand phrase expands to, or [] if
// the phrase isn't a known abbreviation. Never guesses — only the curated table.
export function expandClinicalSynonyms(phrase) {
  const key = foldSynonymKey(phrase);
  return CLINICAL_SYNONYMS[key] ? [...CLINICAL_SYNONYMS[key]] : [];
}

const lower = (s) => String(s || "").toLowerCase();

// Find the intent a request expresses, or null. Longest phrase wins so a request
// can contain several intent words and still resolve to the most specific one.
export function detectIntent(text) {
  const t = lower(text);
  let best = null;
  for (const [intent, phrases] of Object.entries(INTENTS)) {
    for (const p of phrases) {
      // Whole-phrase match only, so "sum" does not fire inside "summarizing"
      // and "count" does not fire inside "account".
      const re = new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
      if (re.test(t) && (!best || p.length > best.length)) {
        best = { intent, phrase: p, length: p.length };
      }
    }
  }
  return best ? { intent: best.intent, phrase: best.phrase } : null;
}

// Pull the first comparator phrase out of a clause, returning { op, phrase } or
// null. Multi-word phrases are matched before single words (see COMPARATORS).
export function detectComparator(text) {
  const t = lower(text);
  for (const entry of COMPARATORS) {
    for (const phrase of entry.phrases) {
      // Require word boundaries so "is" doesn't match inside "basis".
      const re = new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
      if (re.test(t)) return { op: entry.op, phrase };
    }
  }
  return null;
}

// --- Phase 4 (2026-07-10): most-common / top-N ranking family --------------
// Two disjoint wordings, kept apart deliberately:
//  - FREQUENCY words ("most common", "top N", "used most"...) rank how often
//    each VALUE of a column appears — works on any column type (matcher.js
//    treats it like "distinct": no numeric gate needed).
//  - MAGNITUDE words ("longest", "shortest") rank the RAW ROW VALUES of a
//    column by size — gated to a NUMERIC column by matcher.js, same as
//    average/sum (Phase 1's honesty rule).
// No bare "most"/"least"/"top" token triggers this — every phrase here is a
// specific multi-word combination (or "top" + an explicit count), so "at
// most 7"/"at least 5" (existing COMPARATORS phrases) can never be misread
// as a ranking request. Same "false positives beat misses" rule the min/max
// intents already follow (see the comment above INTENTS).
const TOPN_FREQUENCY_MOST = [
  "most frequently used", "most commonly used", "most frequently occurring", "most commonly occurring",
  "most common", "most frequent", "most used", "used most often", "most often used", "used most",
];
const TOPN_FREQUENCY_LEAST = [
  "least frequently used", "least commonly used", "least frequently occurring", "least commonly occurring",
  "least common", "least frequent", "least used", "used least often", "least often used", "used least",
];
const TOPN_MAGNITUDE_MOST = ["longest"];
const TOPN_MAGNITUDE_LEAST = ["shortest"];

// Small, fixed number-word dictionary — enough for "top five", trivial with
// existing machinery. Larger/irregular number words are Phase 7 territory.
const TOPN_NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function findWholePhrase(t, list) {
  for (const p of list) {
    const re = new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    if (re.test(t)) return p;
  }
  return null;
}

// Public: detect the Phase 4 ranking family in raw request text, or null.
// Returns { family: "frequency"|"magnitude", direction: "most"|"least",
// n: number|null, wordPhrase, topPhrase } — `n` is the requested cap (from
// "top 5"/"top five"), or null when unstated (matcher.js picks the family's
// default). `wordPhrase`/`topPhrase` are the literal substrings matched, so
// the caller can strip them before hunting for the target column.
export function detectTopN(text) {
  const t = String(text || "").toLowerCase();
  const topMatch = /\btop\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(t);
  const n = topMatch ? (/^\d+$/.test(topMatch[1]) ? Number(topMatch[1]) : TOPN_NUMBER_WORDS[topMatch[1]]) : null;

  const freqLeast = findWholePhrase(t, TOPN_FREQUENCY_LEAST);
  const freqMost = !freqLeast && findWholePhrase(t, TOPN_FREQUENCY_MOST);
  const magLeast = !freqLeast && !freqMost && findWholePhrase(t, TOPN_MAGNITUDE_LEAST);
  const magMost = !freqLeast && !freqMost && !magLeast && findWholePhrase(t, TOPN_MAGNITUDE_MOST);
  const wordPhrase = freqLeast || freqMost || magLeast || magMost || null;

  if (!wordPhrase && !topMatch) return null;

  const family = magLeast || magMost ? "magnitude" : "frequency"; // bare "top N" defaults to frequency
  const direction = freqLeast || magLeast ? "least" : "most"; // bare "top N" defaults to "most"

  return { family, direction, n, wordPhrase, topPhrase: topMatch ? topMatch[0] : null };
}

// Split a request into nested levels on the "of those" markers, keeping order.
// "Of patients with X, how many got Y, and of those how many had Z" →
//   ["Of patients with X, how many got Y", "how many had Z"].
export function splitNestedLevels(text) {
  let parts = [text];
  for (const marker of NESTED_MARKERS) {
    const next = [];
    for (const part of parts) {
      const pieces = lower(part).includes(marker)
        ? splitOnMarker(part, marker)
        : [part];
      next.push(...pieces);
    }
    parts = next;
  }
  return parts.map((p) => p.replace(/^[\s,;.]+|[\s,;.]+$/g, "")).filter(Boolean);
}

function splitOnMarker(text, marker) {
  const out = [];
  let rest = text;
  let idx = lower(rest).indexOf(marker);
  while (idx !== -1) {
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + marker.length);
    idx = lower(rest).indexOf(marker);
  }
  out.push(rest);
  return out;
}
