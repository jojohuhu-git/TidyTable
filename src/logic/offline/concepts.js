// Phase 3 (plan-2026-07-10-offline-smarts.md) — concept seed groups.
//
// The matcher can already fold word-forms (wordforms.js), but "how long were
// patients treated" still won't find a column called "Duration_days" because
// "long"/"treated" aren't the word "duration". A concept group ties the
// everyday words people reach for to the idea a column captures: length / how
// long / days of therapy all mean DURATION; drug / antibiotic / medication /
// prescribed all mean DRUG; condition / indication mean DIAGNOSIS; kid / child /
// case mean PATIENT.
//
// Honesty stance: a concept match is NEVER an exact match. Exact header hits are
// handled upstream by fuzzyColumn; everything this module proposes is a STRETCH,
// returned as ranked candidates the caller turns into a "did you mean this
// column?" confirm-chip. It never decides an answer on its own.

import { foldWord } from "./wordforms.js";

// Each concept lists:
//   columnWords — words that, in a COLUMN NAME or in the user's phrase, signal
//                 this concept. Stored already word-folded.
//   valueWords  — a small sample of words that, appearing as CELL VALUES, signal
//                 that a column holds this concept (the value-content hint). Kept
//                 short and only for concepts where the values are a small, well-
//                 known vocabulary. Never exhaustive — it only proposes a
//                 candidate to confirm, never auto-answers.
export const CONCEPTS = {
  duration: {
    columnWords: ["duration", "length", "long", "day", "days", "time", "course", "therapy", "treat", "los", "stay"],
    valueWords: [],
  },
  drug: {
    columnWords: ["drug", "antibiotic", "antibiotics", "abx", "medication", "med", "agent", "prescribe", "therapy", "treat"],
    valueWords: [
      "amoxicillin", "cephalexin", "cefpodoxime", "ceftriaxone", "cefazolin", "cefuroxime",
      "penicillin", "ampicillin", "azithromycin", "clindamycin", "ciprofloxacin",
      "levofloxacin", "doxycycline", "vancomycin", "metronidazole", "nitrofurantoin",
      "trimethoprim", "sulfamethoxazole", "gentamicin", "meropenem", "piperacillin",
    ],
  },
  diagnosis: {
    columnWords: ["diagnose", "diagnosis", "condition", "indicate", "indication", "disease", "illness", "dx", "problem"],
    valueWords: [],
  },
  patient: {
    columnWords: ["patient", "kid", "child", "children", "case", "subject", "person", "people", "individual", "mrn"],
    valueWords: [],
  },
  prescriber: {
    columnWords: ["prescriber", "doctor", "physician", "provider", "clinician", "attending", "md"],
    valueWords: [],
  },
  lab: {
    columnWords: ["lab", "labs", "result", "value", "level", "test", "reading", "measurement"],
    valueWords: [],
  },
  date: {
    columnWords: ["date", "visit", "when", "admission", "encounter", "seen"],
    valueWords: [],
  },
};

// word -> Set(conceptId) for column-name/phrase words, all folded.
const WORD_TO_CONCEPTS = new Map();
// folded valueWord -> Set(conceptId).
const VALUEWORD_TO_CONCEPTS = new Map();
for (const [id, spec] of Object.entries(CONCEPTS)) {
  for (const w of spec.columnWords) {
    const f = foldWord(w);
    if (!WORD_TO_CONCEPTS.has(f)) WORD_TO_CONCEPTS.set(f, new Set());
    WORD_TO_CONCEPTS.get(f).add(id);
  }
  for (const v of spec.valueWords) {
    const f = foldWord(v);
    if (!VALUEWORD_TO_CONCEPTS.has(f)) VALUEWORD_TO_CONCEPTS.set(f, new Set());
    VALUEWORD_TO_CONCEPTS.get(f).add(id);
  }
}

function tokens(s) {
  return String(s == null ? "" : s).toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

// Phase 5: the single dominant concept a HEADER name points to (or null), so the
// refinement loop can group a pool of remaining column candidates by idea and ask
// a discriminating question ("the drug given, or the diagnosis?"). Uses the same
// conceptHits scoring as everything else; ties break by CONCEPTS declaration order
// so the choice is deterministic, never guessed.
export function conceptOfHeader(name) {
  const hits = conceptHits(tokens(name));
  if (!hits.size) return null;
  let best = null;
  let bestCount = 0;
  for (const id of Object.keys(CONCEPTS)) {
    const count = hits.get(id) || 0;
    if (count > bestCount) {
      bestCount = count;
      best = id;
    }
  }
  return best;
}

// Is this word (any form) a concept seed word? Used to gate concept resolution:
// a phrase is only concept-resolved when every meaningful word is a concept
// word, so stray words ("uti duration", "duration per") fall through to the
// exact/value/compound machinery instead of forcing a low-signal confirm.
export function isConceptWord(word) {
  return WORD_TO_CONCEPTS.has(foldWord(word));
}

// The concept ids a set of (already tokenized) words points to, with a count of
// how many words backed each concept — so a phrase whose words agree on one
// concept outranks a single incidental hit.
function conceptHits(wordList) {
  const hits = new Map(); // conceptId -> count
  for (const raw of wordList) {
    const f = foldWord(raw);
    const set = WORD_TO_CONCEPTS.get(f);
    if (!set) continue;
    for (const id of set) hits.set(id, (hits.get(id) || 0) + 1);
  }
  return hits;
}

// Propose real header columns a spoken phrase could mean, by concept overlap.
// Returns candidates best-first: { column, score, via }. Never exact — the
// caller always confirms. `score` is (# phrase words that share a concept with
// this header) so Phase 5 can keep the full ranked list.
export function conceptColumnCandidates(phrase, headers) {
  const phraseWords = tokens(phrase);
  if (!phraseWords.length) return [];
  const phraseConcepts = conceptHits(phraseWords);
  if (!phraseConcepts.size) return [];

  const out = [];
  for (const h of headers) {
    const headerWords = tokens(h.name);
    const headerConcepts = conceptHits(headerWords);
    if (!headerConcepts.size) continue;
    // Score: sum over shared concepts of (phrase support). A header that shares
    // the concept the phrase most agrees on scores highest.
    let score = 0;
    const shared = [];
    for (const [id, support] of phraseConcepts) {
      if (headerConcepts.has(id)) {
        score += support;
        shared.push(id);
      }
    }
    if (score > 0) out.push({ column: h.name, score, via: `understood "${phrase}" as the ${shared[0]} column` });
  }
  out.sort((a, b) => b.score - a.score || a.column.length - b.column.length);
  return out;
}

// Value-content hint: a column whose CELL VALUES look like the concept the
// phrase names (e.g. "antibiotics" -> a column full of amoxicillin / cephalexin,
// even if the header is called "Med_A"). Uses the per-column folded-value index
// the matcher already builds. Offered ONLY as a confirm candidate, never auto,
// and only when a clear majority of a column's distinct values are members of
// the concept — so a lone stray value can't nominate a whole column.
export function valueContentCandidates(phrase, headers, index) {
  const phraseWords = tokens(phrase);
  const phraseConcepts = conceptHits(phraseWords);
  if (!phraseConcepts.size) return [];
  // Only concepts that carry a value vocabulary can be confirmed by content.
  const wanted = [...phraseConcepts.keys()].filter((id) => CONCEPTS[id]?.valueWords?.length);
  if (!wanted.length) return [];

  const out = [];
  for (const h of headers) {
    const m = index.get(h.name);
    if (!m || m.size === 0) continue;
    let total = 0;
    let matched = 0;
    for (const original of m.values()) {
      total += 1;
      const vTokens = tokens(original).map(foldWord);
      const isMember = vTokens.some((t) => {
        const set = VALUEWORD_TO_CONCEPTS.get(t);
        return set && wanted.some((id) => set.has(id));
      });
      if (isMember) matched += 1;
    }
    if (total > 0 && matched / total >= 0.6) {
      out.push({ column: h.name, score: matched, via: `"${h.name}" holds values that look like the ${wanted[0]} you asked about` });
    }
  }
  out.sort((a, b) => b.score - a.score || a.column.length - b.column.length);
  return out;
}
