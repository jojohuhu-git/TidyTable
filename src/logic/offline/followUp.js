// Phase 7.1 (plan-2026-07-10-offline-smarts.md) — cross-turn follow-up questions.
//
// Inside ONE sentence the matcher already chains cohorts ("... UTI and of those
// how many got cephalexin"). This module lets the SAME chaining happen ACROSS
// turns, by rewriting a short follow-up into a full request the existing engine
// already understands — deterministic template reuse, never a new AI read:
//
//   1. A bare nested marker ("of those, how many got cephalexin?") reuses the
//      previous question as stage 1: the follow-up is glued onto the end of the
//      last request, so extractCohort + splitNestedLevels resolve it exactly as
//      they would a single long sentence.
//   2. "what about ceftriaxone?" re-runs the LAST question with one value
//      swapped — the previous filter value is replaced, in the previous request
//      text, by the new one.
//
// Nothing here executes anything or guesses a column/value; it only produces a
// longer request string for runOffline to read honestly (and spell back in its
// trust line). When it cannot form a confident rewrite it returns null, and the
// caller runs the user's raw words — which then decline plainly, never guess.

import { NESTED_MARKERS } from "./synonyms.js";

// The nested markers that can OPEN a follow-up turn ("of those, ...", "among
// them, ..."). Longest first so "and of those" wins over "of those".
const OPENERS = [...NESTED_MARKERS].sort((a, b) => b.length - a.length);

// "what about X" / "how about X" / "and X?" — re-ask the last question about a
// different value. The captured phrase is the new value to swap in.
const SWAP_RE = /^\s*(?:and\s+|but\s+|so\s+)?(?:what|how)\s+about\s+(.+?)\s*\??\s*$/i;

const lower = (s) => String(s || "").toLowerCase().trimStart();

// Classify a raw request as a follow-up, or null. Deliberately conservative:
// only a request that STARTS with a follow-up cue counts, so an ordinary
// question that merely contains "of those" mid-sentence is left alone (the
// in-sentence machinery already handles that).
export function detectFollowUp(request) {
  const t = lower(request);
  if (!t) return null;
  const swap = SWAP_RE.exec(String(request));
  if (swap) {
    const value = swap[1].trim();
    return value ? { kind: "swap", value } : null;
  }
  for (const marker of OPENERS) {
    if (t.startsWith(marker)) return { kind: "nested", marker };
  }
  return null;
}

// The value the LAST value-kind filter matched, so a "what about X" swap knows
// what to replace. Prefers the user's typed phrase (`term`) over the resolved
// cell value, since that is what actually appears in the previous request text;
// falls back to the value. Returns null when the last question had no value
// filter to swap (e.g. a bare "how many rows").
export function lastFilterValue(match) {
  const stages = match?.stages || [];
  for (let i = stages.length - 1; i >= 0; i--) {
    const c = stages[i]?.condition;
    if (c && c.kind === "value") return c.term || (c.value != null ? String(c.value) : null);
  }
  return null;
}

// Case-insensitive whole-word replacement of the FIRST occurrence of `find`
// in `text` with `replacement`. Returns null when `find` is not present, so
// the caller can fall back rather than silently answer the wrong question.
function replaceWord(text, find, replacement) {
  if (!find) return null;
  const re = new RegExp(`(^|[^a-z0-9])(${find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})([^a-z0-9]|$)`, "i");
  if (!re.test(text)) return null;
  return text.replace(re, (_m, pre, _mid, post) => `${pre}${replacement}${post}`);
}

// Turn a follow-up into a full request the engine can read, using the last
// answered question. `last` = { request, swapTerm }. Returns { request } with
// the rewritten text, or null when no confident rewrite is possible (no prior
// question, or a swap whose value can't be located to replace).
export function applyFollowUp(rawRequest, last) {
  if (!last || !last.request) return null;
  const follow = detectFollowUp(rawRequest);
  if (!follow) return null;

  if (follow.kind === "nested") {
    // Glue the follow-up onto the previous request as another "of those" level.
    // A trailing comma/period on the previous request is normalized first so the
    // seam reads as one sentence.
    const base = String(last.request).replace(/[\s,;.]+$/, "");
    return { request: `${base}, ${String(rawRequest).trim()}` };
  }

  // swap: replace the previous filter value with the new one, in the previous
  // request text. If the old value isn't found there, decline the rewrite.
  const swapped = replaceWord(String(last.request), last.swapTerm, follow.value);
  if (!swapped) return null;
  return { request: swapped };
}
