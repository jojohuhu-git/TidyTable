// Phase 3 (plan-2026-07-10-offline-smarts.md) — word-form folding.
//
// The matcher knows column *names*, but people type the words around them in
// whatever grammatical form comes to mind: "treated" for "treatment",
// "prescriptions" for "prescribed", "diagnoses" for "diagnosis". This module
// folds those everyday word-forms down to one canonical token so the scorer in
// valueMatch.js and the concept lookup in concepts.js see the same base word no
// matter which form was typed.
//
// It is deliberately NOT a general stemmer — an over-eager stemmer merges words
// that mean different things (the classic "prescriber" vs "prescription" trap)
// and would manufacture false matches, exactly what the never-guess promise
// forbids. Instead it uses a small, hand-curated table of word FAMILIES (verb /
// noun / adjective forms that genuinely name the same idea) plus conservative
// plural stripping. Anything not in a family only loses a trailing plural "s".

// Each family lists every surface form that should fold to the family's first
// entry (its canonical token). Keep families tight: only forms that a clinician
// would use interchangeably to name the same column concept belong together.
// Note "prescriber"/"prescribers" is deliberately NOT in the prescribe family —
// a prescriber is a person (a column), a prescription is the drug record; the
// concept layer keeps them apart.
const FAMILIES = [
  ["treat", "treats", "treated", "treating", "treatment", "treatments"],
  ["prescribe", "prescribed", "prescribing", "prescription", "prescriptions"],
  ["diagnose", "diagnosed", "diagnosing", "diagnosis", "diagnoses"],
  ["medication", "medications", "medicine", "medicines", "med", "meds"],
  ["duration", "durations", "lasting", "lasted"],
  ["length", "lengths"],
  ["admit", "admits", "admitted", "admitting", "admission", "admissions"],
  ["visit", "visits", "visited", "visiting"],
  ["result", "results", "resulted"],
  ["indicate", "indicated", "indication", "indications"],
];

// Build member -> canonical once.
const CANONICAL = new Map();
for (const family of FAMILIES) {
  const canon = family[0];
  for (const form of family) CANONICAL.set(form, canon);
}

// Conservative plural -> singular for words that are NOT in a family. Mirrors
// matcher.js's singularize but returns the folded singular form.
function depluralize(word) {
  if (/oses$/i.test(word)) return word.slice(0, -4) + "osis"; // diagnoses -> diagnosis
  if (/(ches|shes|xes|sses)$/i.test(word)) return word.slice(0, -2);
  if (/ies$/i.test(word)) return word.slice(0, -3) + "y"; // categories -> category
  if (/s$/i.test(word) && !/ss$/i.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

// Fold one lowercase token to its canonical word-form. Family membership wins;
// otherwise strip a plural. Single/very short tokens are returned untouched so a
// stray letter can never fold into something meaningful.
export function foldWord(word) {
  const w = String(word || "").toLowerCase();
  if (w.length < 3) return w;
  if (CANONICAL.has(w)) return CANONICAL.get(w);
  return depluralize(w);
}

// Fold every token in a token array.
export function foldTokens(list) {
  return (list || []).map(foldWord);
}
