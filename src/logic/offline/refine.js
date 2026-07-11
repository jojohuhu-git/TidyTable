// Phase 5 (plan-2026-07-10-offline-smarts.md) — the "no → better guess" loop.
//
// When the matcher stretches (fuzzy value, concept column, abbreviation, tie) it
// hands the UI a "Did you mean…?" box. Before Phase 5 the only escape was a
// cancel button that gave up. This module turns that dead end into a loop: a
// real "None of these" click eliminates the rejected guesses and produces a
// SMARTER next question from what remains — either the next ranked candidates
// (small remainder) or a discriminating question that bisects a large remainder
// ("Is your question about the drug given, or the diagnosis?"). Each answer
// narrows the pool. One survivor is still CONFIRMED (never auto-run); zero
// survivors is an honest decline that hands off to AI.
//
// Honesty stance (load-bearing): the pool only ever SHRINKS. No candidate is
// ever invented mid-loop — re-reading the sentence a brand-new way is exactly
// what this must not attempt; that is the AI boundary. Everything here is pure
// and deterministic.

import { conceptOfHeader } from "./concepts.js";

// Plain-word label for each concept, for the discriminating question. No jargon.
const CONCEPT_LABEL = {
  duration: "a length of time",
  drug: "the drug given",
  diagnosis: "the diagnosis",
  patient: "the patient",
  prescriber: "who prescribed it",
  lab: "a lab value",
  date: "a date",
};
const OTHER_LABEL = "something else";

// How many candidate chips a single round shows. Above this we ask a grouping
// question instead of paging a long list at the user.
const CHIP_ROUND_MAX = 3;
// A hard stop even though progress is structurally guaranteed (chip rounds always
// drop ≥1; group rounds only fire when the pool is large). A cap-hit is an honest
// decline, never a guess.
const MAX_ROUNDS = 6;

// A stable identity for a candidate, so "rejected" and "shown" comparisons work
// and the pool can be deduped. Column chips are keyed by column; value chips by
// column+value (the same value can legitimately live in two columns).
function candKey(c) {
  return c && c.kind === "column" ? `col:${c.column}` : `val:${c?.column}::${c?.value}`;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const c of list || []) {
    const k = candKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// Begin a refinement. `pool` is the full ranked list (allCandidates preferred,
// candidates as the fallback), deduped; the first ≤3 become round 1's chips and
// the rest wait in the pool for "None of these".
export function startRefinement({ phrase, candidates, allCandidates, via, request }) {
  const full = dedupe(allCandidates && allCandidates.length ? allCandidates : candidates);
  const shown = full.slice(0, CHIP_ROUND_MAX);
  const pool = full.slice(CHIP_ROUND_MAX);
  // phase: what the CURRENT round is offering — "chips" (the ≤3 in `shown`) or
  // "group" (a discriminating question over the whole remaining `pool`).
  // Rejecting a chips round drops only those ≤3; rejecting a group round rejects
  // the entire remaining pool (the user said none of the offered ideas fit).
  return { phrase, request, via: via || null, pool, shown, rejected: [], round: 1, phase: "chips", groupFilter: null };
}

// Build the next chip round from a list of remaining candidates: show ≤3, keep
// the rest in the pool. Shared by "None of these" paging and group-pick.
function chipRound(state, remaining, extra = {}) {
  const shown = remaining.slice(0, CHIP_ROUND_MAX);
  const pool = remaining.slice(CHIP_ROUND_MAX);
  const next = { ...state, ...extra, shown, pool, phase: "chips", round: state.round + 1 };
  return { done: false, state: next, kind: "chips", options: shown };
}

// The user clicked "None of these": reject what the current round offered and
// decide the next round from what's left. Returns either a chips round, a group
// (discriminating) question, or done:true when nothing remains.
export function rejectShown(state, { headers = [] } = {}) {
  // A group round offers the WHOLE remaining pool at once (as concept/column
  // buckets), so rejecting it means none of the remaining candidates fit → the
  // loop is exhausted. A chips round only rejects the ≤3 it showed.
  if (state.phase === "group") {
    const rejected = [...state.rejected, ...state.shown, ...state.pool];
    return { done: true, outcome: "exhausted", state: { ...state, rejected, pool: [] } };
  }

  const rejected = [...state.rejected, ...state.shown];
  const base = { ...state, rejected };

  if (base.round >= MAX_ROUNDS || base.pool.length === 0) {
    return { done: true, outcome: "exhausted", state: base };
  }

  // Small remainder — just page the next best guesses.
  if (base.pool.length <= CHIP_ROUND_MAX) {
    return chipRound(base, base.pool);
  }

  // Large remainder — ask a discriminating question that splits the pool.
  const groups = groupPool(base.pool);
  if (groups.length >= 2) {
    return {
      done: false,
      // A group round shows nothing in `shown` — the pool IS the offer.
      state: { ...base, shown: [], phase: "group", round: base.round + 1 },
      kind: "group",
      question: groupQuestion(base, groups),
      groups,
    };
  }

  // Grouping can't discriminate (everything in one bucket) — fall back to paging.
  return chipRound(base, base.pool);
}

// Split a pool into named groups. Column chips group by their dominant concept
// (an unclassifiable header → the "other" bucket). Value chips group by the
// column the value sits in. Groups keep pool order (ranked) within each bucket.
function groupPool(pool) {
  const isColumn = pool[0]?.kind === "column";
  const buckets = new Map(); // key -> { key, label, items }
  for (const c of pool) {
    let key;
    let label;
    if (isColumn) {
      const concept = conceptOfHeader(c.column);
      key = concept || "__other__";
      label = concept ? CONCEPT_LABEL[concept] || concept : OTHER_LABEL;
    } else {
      key = `col:${c.column}`;
      label = `the "${c.column}" column`;
    }
    if (!buckets.has(key)) buckets.set(key, { key, label, items: [] });
    buckets.get(key).items.push(c);
  }
  return [...buckets.values()];
}

// The plain-English discriminating question for a set of groups.
function groupQuestion(state, groups) {
  const isColumn = state.pool[0]?.kind === "column";
  const labels = groups.map((g) => g.label);
  const list =
    labels.length === 2
      ? `${labels[0]}, or ${labels[1]}`
      : labels.slice(0, -1).join(", ") + ", or " + labels[labels.length - 1];
  return isColumn
    ? `Is your question about ${list}?`
    : `Is "${state.phrase}" something in ${list}?`;
}

// The user picked one group from a discriminating question. Narrow the pool to
// that group and show its best ≤3 as chips. Picking a group never answers
// anything by itself — it only shrinks the space.
export function pickGroup(state, groupKey, groups) {
  const group = (groups || []).find((g) => g.key === groupKey);
  const remaining = group ? group.items : state.pool;
  return chipRound(state, remaining, { groupFilter: groupKey });
}
