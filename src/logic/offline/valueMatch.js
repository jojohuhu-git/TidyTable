// W2: the smarter, honest value/column matcher for the offline engine.
//
// The old value scan only matched a folded whole phrase or one whole word, so
// "e coli" never found "ESCHERICHIA COLI". This module adds a token-subset tier
// (every query word equals OR is a prefix of some value word), scores the
// candidates so the strongest wins, and — crucially — always spells back the
// REAL cell value it landed on, so a stretch is visible and confirmable rather
// than a silent guess. Nothing here executes a filter; it only proposes what a
// phrase most likely means, tagged with how far the app had to stretch.

import { foldWord } from "./wordforms.js";

// Split any text into lowercase alphanumeric word tokens.
export function tokens(s) {
  return String(s == null ? "" : s).toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

// Phase 3: word-forms are folded ONLY for column-CONCEPT matching (concepts.js),
// never for cell-VALUE scoring below. Folding a value scan is where the
// never-guess promise is most at risk — e.g. "patients" would deplural to
// "patient" and hijack a "PatientID" column — so scoreTokenMatch deliberately
// compares raw tokens. foldWord stays imported for callers that opt in.
void foldWord;

// Score how well a set of query tokens matches a set of value tokens, or return
// null for no match. Higher is a better/closer match:
//   3 — exact: the query tokens ARE the value tokens (same set, same size)
//   2 — all-tokens-equal: every query token equals some value token (value may
//       have extra words, e.g. "coli" in "escherichia coli")
//   1 — prefix: every query token equals or is a prefix of some value token
//       (e.g. "e"/"coli" against "escherichia"/"coli")
// A single-letter query token ("e") may only match as a prefix, never stand on
// its own as an exact word, so a stray "e" can't hijack a whole column.
export function scoreTokenMatch(queryTokens, valueTokens) {
  if (!queryTokens.length || !valueTokens.length) return null;
  const vset = new Set(valueTokens);
  let allEqual = true;
  for (const q of queryTokens) {
    if (vset.has(q)) continue; // this token matched a whole value word
    allEqual = false;
    // Prefix tier: does some value word start with this query token?
    const prefixHit = valueTokens.some((v) => v.length > q.length && v.startsWith(q));
    if (!prefixHit) return null; // a query word that matches nothing at all — no match
  }
  if (allEqual) {
    return queryTokens.length === valueTokens.length ? 3 : 2;
  }
  return 1;
}

// Scan the given columns for cell values a phrase could mean. `index` is the
// per-column Map(foldedValue -> originalValue) the matcher already builds.
// Returns candidates sorted best-first: { column, value, score, exact }.
// `exact` marks a score-3 whole-phrase equality (no stretch, answer directly).
export function findValueCandidates(phrase, headers, index, { columns = null } = {}) {
  const qTokens = tokens(phrase);
  if (!qTokens.length) return [];
  const scope = columns || headers.map((h) => h.name);
  const out = [];
  const seen = new Set(); // dedupe identical column::value pairs
  for (const colName of scope) {
    const m = index.get(colName);
    if (!m) continue;
    for (const original of m.values()) {
      const score = scoreTokenMatch(qTokens, tokens(original));
      if (score == null) continue;
      const key = `${colName}::${String(original).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ column: colName, value: original, score, exact: score === 3 });
    }
  }
  // Best score first; break ties by shorter value (a tighter match) then name.
  out.sort((a, b) =>
    b.score - a.score
    || String(a.value).length - String(b.value).length
    || String(a.value).localeCompare(String(b.value)),
  );
  return out;
}

// W2c: fuzzy-match a spoken phrase to one or more header names by token subset,
// so "urine" hits "Urine Organisms". Returns matching header names, best-first.
// Exact columnKey equality (handled by the caller's fuzzyColumn) is stronger and
// checked there first; this is the stretch tier.
export function findColumnCandidates(phrase, headers) {
  const qTokens = tokens(phrase);
  if (!qTokens.length) return [];
  const out = [];
  for (const h of headers) {
    const score = scoreTokenMatch(qTokens, tokens(h.name));
    if (score != null) out.push({ column: h.name, score });
  }
  out.sort((a, b) => b.score - a.score || a.column.length - b.column.length);
  return out.map((c) => c.column);
}

// W2e: when nothing resolves, offer the user the nearest things the app CAN see
// instead of only "add a definition / use AI". Rank every distinct cell value
// (and header name) by how many query tokens overlap it (whole word or prefix),
// and return the top N as { kind: "value"|"column", column?, value|name } chips.
export function nearestSuggestions(phrase, headers, index, n = 3) {
  const qTokens = tokens(phrase);
  if (!qTokens.length) return [];
  const overlap = (targetTokens) => {
    let hits = 0;
    for (const q of qTokens) {
      if (targetTokens.some((t) => t === q || (t.length > q.length && t.startsWith(q)) || (q.length > t.length && q.startsWith(t)))) hits++;
    }
    return hits;
  };
  const scored = [];
  for (const h of headers) {
    const o = overlap(tokens(h.name));
    if (o > 0) scored.push({ kind: "column", name: h.name, overlap: o, len: h.name.length });
    const m = index.get(h.name);
    if (!m) continue;
    for (const original of m.values()) {
      const o2 = overlap(tokens(original));
      if (o2 > 0) scored.push({ kind: "value", column: h.name, value: original, overlap: o2, len: String(original).length });
    }
  }
  // Most overlap first, then shorter (tighter) targets.
  scored.sort((a, b) => b.overlap - a.overlap || a.len - b.len);
  const out = [];
  const seen = new Set();
  for (const s of scored) {
    const key = s.kind === "column" ? `c:${s.name}` : `v:${s.column}::${String(s.value).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.kind === "column" ? { kind: "column", name: s.name } : { kind: "value", column: s.column, value: s.value });
    if (out.length >= n) break;
  }
  return out;
}
