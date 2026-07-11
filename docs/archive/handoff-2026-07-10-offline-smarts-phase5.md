# Handoff — Offline-Smarts Plan: Phase 5 DONE (2026-07-10)

**Plan:** `.claude/prompts/plan-2026-07-10-offline-smarts.md` (Phase 5 section).
**Design:** `.claude/prompts/design-2026-07-10-phase5-refinement.md` (Fable-authored, followed).
**Builds on:** Phase 3 (`handoff-2026-07-10-offline-smarts-phase3.md`) — its "Candidate
lists preserved & ranked" note is the hook this phase cashes in — and Phase 4
(`handoff-2026-07-10-offline-smarts-phase4.md`), 621 tests at that point.
**Next up:** The owner said "will do Phase 4 after 5." **Heads-up for that session:** the
offline-smarts plan's Phase 4 (most-common / top-N ranking) is ALREADY shipped and merged
(see `handoff-2026-07-10-offline-smarts-phase4.md`), so "Phase 4" here must mean a
different track — confirm with the owner which one before starting. If they instead mean
continuing THIS plan, the next unbuilt phase is **Phase 6** (self-teaching test bank +
AI graduation), which is the natural follow-on to this refinement loop.

## What shipped (Phase 5 — the "no → better guess" refinement loop)

Before Phase 5, a "Did you mean…?" confirm box offered the top 2–3 guesses and a cancel
button that just gave up. Now the box has a real **"None of these"**: clicking it
eliminates the rejected guesses and asks a *smarter next question* from what remains —
either the next-best candidates (small remainder) or a plain-word **discriminating
question** that splits a large remainder ("Is your question about a length of time, the
drug given, or the diagnosis?"). Each answer narrows the pool. One survivor is still a
confirm chip (never auto-answered); when every guess is rejected the engine stops
honestly and offers the AI. Exchanges that took >1 round (and every exhaustion) are
logged so the owner sees which questions needed more than one round.

Scope is **Step 3 only** — the Step 9 chart parser is untouched (the plan's Phase 8
"one brain" rebuild is the place to share this loop with charts).

### New code
- `src/logic/offline/refine.js` — the whole loop, pure and UI-free:
  `startRefinement` (windows the full ranked pool into round-1 chips + a held pool),
  `rejectShown` ("None of these" → next chips / a group question / exhausted),
  `pickGroup` (narrow to one concept/column group → chips). A `phase: "chips" | "group"`
  field on the state records what the current round offers, so rejecting a chips round
  drops only its ≤3, while rejecting a group round rejects the *entire* remaining pool
  (the user said none of the offered ideas fit). Hard cap of 6 rounds — a cap-hit is an
  honest decline, never a guess.
- `src/logic/offline/concepts.js` — new `conceptOfHeader(name)` export: the single
  dominant concept a header points to (or null), for grouping a mixed candidate pool.
  Ties break by `CONCEPTS` declaration order, so grouping is deterministic.

### Changed
- `src/logic/offline/matcher.js` — every stretch now also returns a **new sibling field
  `allCandidates`** carrying the FULL ranked list, alongside the unchanged `candidates`
  (still the round-1 top 2–3). Threaded through `resolveColumnRef`, the value scan (the
  whole scored list, not just the strong ties), the expanded-abbreviation path,
  `resolveGroupBy`, `valueCondition`, `resolveCondition`, `columnConfirm`,
  `buildConfirmation`. `cleanCondition` strips `allCandidates` too, so executed plans and
  serialized transforms stay byte-for-byte identical to before Phase 5.
- `src/logic/offline/runOffline.js` — the `confirm-value` result passes `allCandidates`
  through (falls back to `candidates`).
- `src/logic/offline/missLog.js` — new `logRefinement({ request, phrase, rounds, outcome,
  rejectedColumns })`. `outcome` is `refined-success` or `refined-exhausted`.
  **PRIVACY:** `rejectedColumns` are column NAMES only — a rejected *value* candidate
  contributes its column name, never the cell value. `formatMisses` renders the round
  count (`(refined-success, 2 rounds)`).
- `src/App.jsx` — `pendingConfirm` now wraps a refine-loop state. Round 1 renders exactly
  as before **plus** a "None of these" option; the old cancel is relabeled "Not now"
  (the label "Something else" now belongs to the refinement path). New handlers
  `refineReject`, `refinePickGroup`, `finishRefinementExhausted`; `answerConfirm` logs a
  `refined-success` when the confirmed pick came after ≥1 rejection round. Exhaustion
  shows an honest-stop notice and, if an API key exists, routes to Claude via the
  existing decline machinery (shape-only hint, no cell values).
- `src/components/ClarifyBox.jsx` — **unchanged** (its question/options/onAnswer/onCancel
  API already sufficed; option values are now prefixed `cand:` / `group:` / `none`).

## Honesty invariants held (verified by tests)
1. Never a silent guess — a lone surviving candidate is still a chip.
2. The pool only ever SHRINKS — no candidate is invented mid-loop (that's the AI
   boundary, and where exhaustion hands off).
3. Privacy — nothing persisted holds a cell value; rejected value candidates log their
   column name only (test seeds real example values and asserts none appear in storage).
4. Deterministic — no AI anywhere in the loop.

## Tests
- Before: **621**. After: **641** (+20). Full `npm test` green; `npm run build` clean
  (the pre-existing 500 kB chunk-size warning is unchanged, not an error).
- `src/logic/offline/phase5-refinement.test.js` (16) — matcher preserves `allCandidates`
  longer than `candidates`; `startRefinement` windows/dedupes; chips-round elimination
  (rejected never reappear); discriminating question over a mixed pool (columns by
  concept, values by column) + `pickGroup`; one-group paging fallback; a lone survivor is
  still a chip; exhaustion + escapable group round; `logRefinement` round count + the
  privacy boundary + dedupe; `cleanCondition` strips `allCandidates` from a confident
  plan. (Runs under happy-dom for `localStorage`.)
- `src/phase5-refinement.dom.test.jsx` (4) — user-visible: "None of these" swaps in a new
  round (no answer, no decline); confirming a round-2 candidate answers AND persists the
  column alias; rejecting every round shows the honest-stop notice + logs
  `refined-exhausted`; a >1-round success shows in the miss-log export with its count.
- All Phase 1–4 banks untouched and green.

## Also verified live (dev server, port 5175)
On the built-in example file: "average treatment length" shows the round-1 box with the
Duration_days chip **and** a real "None of these"; clicking "None of these" (the example
has a single duration column, so the pool empties) produces the honest-stop notice — no
answer card — and logs a `refined-exhausted` entry whose `rejectedColumns` is
`["Duration_days"]` (a column name, privacy intact). No console errors. The multi-round
paging and group-question paths (which need a file with several duration-ish or
cross-concept columns) are exercised by the DOM/logic tests rather than the single-file
example.

## Judgment calls & deferrals (do not re-decide)
- **Operation-level discriminating question deferred.** The plan's example ("count of
  patients, or an average of a number?") has no reachable state today — intent is
  deterministic from wording and `needs_confirm` is always a column/value reference.
  Wiring a question no code path can ask would be dead code. Revisit if Phase 6's bank
  surfaces a real operation-ambiguous phrasing.
- **Chart side untouched** — Phase 8's "one brain" rebuild is the vehicle for sharing
  this loop with Step 9.
- **Value-candidate tail is included in the pool.** After the strong ties are rejected,
  the lower-scored value matches become the honest next guesses — they were only hidden
  to keep round 1 tight, not because they're wrong.
- **A group question fires only when the held pool is >3** (round 1 always shows ≤3;
  4+ remaining is what makes a bisecting question worth more than paging).
- **Discriminating labels are plain words** ("a length of time", "the drug given", "the
  diagnosis", …), never concept ids or column jargon.

## State checkpoint
- Branch `phase/5-refinement` (from `main`). Note: this branch also carries an unrelated
  housekeeping commit (`9080896`, "Archive 12 completed prompt/handoff files") made
  before the Phase 5 code — it moves finished prompts/handoffs into `docs/archive` per
  the repo's root-hygiene convention and is benign, but it is NOT part of Phase 5.
- 641 tests green, build clean at handoff time.
- Started by a Sonnet agent (matcher `allCandidates` work) which hit a session limit
  mid-task; finished by the coordinating session (refine.js, missLog, App/ClarifyBox
  wiring, all tests, live check, this handoff).
