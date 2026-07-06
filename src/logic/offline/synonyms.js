// Shared word lists for the offline engine (build prompt §8). Everyday words the
// owner and their users actually type map onto a small set of intents and
// comparators. This is deliberately a plain lookup, not a grammar — anything it
// can't place with confidence goes to Claude or is declined (§3.5).

// --- intents ---------------------------------------------------------------
// Each intent lists the phrases that mean it. Longer phrases are checked first
// so "how many" wins over a stray "many".
export const INTENTS = {
  count: ["how many", "number of", "count of", "count", "tally", "total number"],
  sum: ["total", "sum of", "sum", "add up", "added up", "combined"],
  average: ["average", "mean", "typical", "avg"],
  distinct: ["how many different", "how many unique", "distinct", "unique", "different"],
  proportion: ["what share", "what proportion", "what percent", "percentage of", "percent of", "proportion of", "share of", "what fraction", "fraction of"],
};

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
