# Design — Phase 5: the "no → better guess" refinement loop (2026-07-10)

**Plan:** `.claude/prompts/plan-2026-07-10-offline-smarts.md` (Phase 5 section).
**Builds on:** Phase 3 (`docs/archive/handoff-2026-07-10-offline-smarts-phase3.md`) —
its "Candidate lists preserved & ranked" note is the hook this phase cashes in.
Phase 4 handoff (`handoff-2026-07-10-offline-smarts-phase4.md`) documents current state:
621 tests green on main.

**Designed by:** Fable (this doc). **Wired by:** Sonnet implementing agent.
**Branch:** `phase/5-refinement`. Do NOT merge to main — commit on the branch and stop;
the coordinating session reviews, merges, pushes, and watches the deploy.

---

## What Phase 5 is, in one paragraph

Today, when the matcher stretches (fuzzy value, concept column, abbreviation, tie), the
UI shows a "Did you mean…?" box with the top 2–3 candidates and a cancel button labeled
"Something else" that just gives up. Phase 5 turns that dead end into a loop: the box
gains a real **"None of these"** option; clicking it eliminates the rejected candidates
and asks a *smarter next question* built from what remains — either the next ranked
guesses directly (small remainder) or a **discriminating question** that bisects a large
remainder ("Is your question about the drug given, or the diagnosis?"). Each answer
narrows the pool. When one candidate remains it is still *confirmed* (never auto-run);
confirming persists the Phase 3 column alias exactly as today. When **zero** remain, the
engine declines honestly and offers AI — that boundary is where offline genuinely ends.
Every exchange that took more than one round is logged so the owner sees which questions
needed >1 round.

Scope: **Step 3 only.** The Step 9 chart parser keeps its current behavior — the plan's
Phase 8 "one brain" rebuild is the designated place to share this loop with charts.

## Honesty invariants (unchanged, load-bearing)

1. Never a silent guess: every candidate surfaced is a chip the user clicks; a single
   surviving candidate is still a chip, not an auto-answer.
2. False positives are worse than misses: the refinement pool only ever *shrinks*; no
   new candidates are invented mid-loop. Re-reading the sentence a brand-new way is
   exactly what the loop must NOT attempt — that's the AI boundary.
3. Privacy: nothing persisted may contain a cell value. Rejected VALUE candidates are
   logged by their **column name only**. (Alias store behavior unchanged: column chips
   persist, value chips stay session-only.)
4. Deterministic: no AI anywhere in the loop.

---

## A. Matcher — keep the full ranked list (`allCandidates`)

Currently every stretch truncates to 3 before the UI sees it. Keep the existing
`candidates` field byte-for-byte (top 2–3, existing tests and UI depend on it) and add
a **new sibling field `allCandidates`** carrying the full ranked list, same element
shapes. Places to touch in `src/logic/offline/matcher.js`:

1. **`resolveColumnRef`** (~line 134): `cands.slice(0, 3)` → also return
   `allCandidates: cands.map(…)` (full, ranked, deduped by column). `cands` here is the
   merged alias→exact→concept→value-content ranking; concepts.js already returns full
   ranked lists with scores for exactly this purpose (see its line ~108 comment).
2. **Value scan** (~line 492): today only `strongTies.slice(0, 3)` survive. For
   `allCandidates`, keep the WHOLE scored `candidates` list (all scores, ranked, deduped
   by column+value) — after the user rejects the strong ties, the lower-scored matches
   are legitimately the "better next guesses". Do not change which candidates appear in
   round 1 (`candidates` stays strong-ties-top-3).
3. **Expanded-abbreviation path** (~line 510): same treatment.
4. **`columnConfirm` / `buildConfirmation`** (~lines 701–729): thread `allCandidates`
   through onto the `needs_confirm` result, mapped to the same chip shapes as
   `candidates` (`{kind:"column", column, via}` / `{column, value}`). Fall back to
   `candidates` when a call site has no fuller list.
5. **`cleanCondition`** (~line 689): add `allCandidates` to the stripped annotation
   fields so executed plans/transforms stay byte-identical to pre-Phase-5.
6. **`runOffline.js`** `confirm-value` branch: pass `allCandidates` through.

## B. New pure module `src/logic/offline/refine.js`

All loop logic lives here, node-testable, UI-free. Shapes:

```js
// state = {
//   phrase, request, via,
//   pool: [...],      // ranked candidates NOT yet shown (full-list tail)
//   shown: [...],     // the current round's chips (<= 3)
//   rejected: [...],  // everything the user has said "no" to
//   round: 1,         // 1-based; round 1 is the existing first box
//   groupFilter: null // set after a discriminating-question answer
// }
```

- `startRefinement({ phrase, candidates, allCandidates, via, request })` → state.
  Pool = `allCandidates || candidates`, deduped (column key for column chips,
  column+value for value chips); `shown` = first ≤3; rest stays in pool.
- `rejectShown(state, { headers })` — the "None of these" click. Moves `shown` →
  `rejected`, then decides the next round from the remaining pool:
  - **pool empty** → `{ done: true, outcome: "exhausted", state }`.
  - **pool ≤ 3** → next chips round: `{ done: false, state', question, options }` where
    options are the pool candidates (they become the new `shown`).
  - **pool > 3** → a **discriminating question** instead of more chips:
    - Column candidates: classify each remaining header by its dominant concept
      (reuse `concepts.js` — export a small `conceptOfHeader(name)` helper that runs
      `conceptHits(tokens(name))` and returns the top concept id or null). Group the
      pool by concept (`null` → "other"). If ≥2 groups exist, ask
      `Is your question about <label A>, <label B>, or something else?` with one option
      per group. Plain-word labels: duration → "a length of time", drug → "the drug
      given", diagnosis → "the diagnosis", patient → "the patient", prescriber → "who
      prescribed it", lab → "a lab value", date → "a date", other → "something else".
    - Value candidates: group by **column** — `Is "<phrase>" something in the "Drug"
      column, or the "Diagnosis" column?`
    - If everything falls in ONE group (grouping can't discriminate), just page: show
      the next ≤3 chips.
- `pickGroup(state, groupKey)` → filters pool to that group, returns the next chips
  round (top ≤3 of the group). Picking a group never answers anything by itself.
- Picking an actual candidate chip is terminal and is handled by App's existing
  `answerConfirm` (alias persistence for `kind:"column"` unchanged).
- **Safety cap:** after 6 rounds total, return exhausted (progress is structurally
  guaranteed — chips rounds always remove ≥1, group rounds only occur when pool > 3 —
  but cap anyway; a cap-hit is an honest decline, never a guess).

## C. Exhaustion → honest decline + AI offer

When the loop exhausts (or cap-hits), App shows a notice — suggested wording:

> I showed you every guess I had for "<phrase>" and none of them fit. This is where the
> offline engine honestly stops — understanding the sentence a different way needs the
> AI. [existing add-key / send-to-Claude affordance]

If a key exists, offer the same one-click "send to Claude" the decline path already has,
with a claudeHint that stays shape-only (no cell values, keep it generic):
`"A local pre-check offered its ranked guesses for an ambiguous reference and the user
rejected all of them."` Route through the existing decline/`runViaClaude` machinery in
App.jsx rather than inventing a parallel path.

## D. Miss-log extension (`src/logic/offline/missLog.js`)

New export `logRefinement({ request, phrase, rounds, outcome, rejectedColumns })`:
- `outcome`: `"refined-success"` (user confirmed a candidate after ≥1 "None of these")
  or `"refined-exhausted"`.
- `rejectedColumns`: column names only — for a rejected VALUE candidate, log its column
  name, never the value. Dedupe.
- Reuses the same storage/list/cap; entries get `reason: outcome` and
  `detail: { phrase, rounds, rejectedColumns }`.
- `formatMisses` renders the round count, e.g. `- 2026-07-10  (refined-success, 2 rounds)  <request>`.
- Log **only** exchanges with >1 round (a round-1 confirm is today's behavior, not
  news) plus every exhaustion.

## E. App.jsx / UI wiring

- `pendingConfirm` state becomes the refine state (or wraps it). Round 1 renders
  exactly as today (same question wording via `confirmQuestion`, same chips) **plus** a
  new `None of these` option appended to the options list (a real option, not the
  cancel). Keep `onCancel` as a pure dismiss but relabel it `Not now` — the current
  label "Something else" now belongs to the refinement path, and keeping it on cancel
  would be misleading.
- "None of these" → `rejectShown`; render the returned question/options in the same
  ClarifyBox. Chips rounds get candidate chips + "None of these" again. Group rounds
  get one option per group **plus** their own "None of these", which rejects the
  entire remaining pool → exhausted (a user who says the question is about none of the
  offered concepts has told us the whole pool is wrong; paging them through it anyway
  would be guess-pushing).
- Candidate chip click → existing `answerConfirm` unchanged (session aliasMap + Phase 3
  persistent column alias + immediate re-run). Also call `logRefinement` with
  `refined-success` when `state.round > 1`.
- Exhausted → clear pendingConfirm, show the §C notice, offer Claude if key present,
  `logRefinement` with `refined-exhausted`.
- ClarifyBox itself needs no API change (question + options + onAnswer + onCancel
  already suffice). Style the "None of these" option like the others; no new CSS
  tokens.

## F. Tests (both layers, per repo rule)

Logic — `src/logic/offline/phase5-refinement.test.js`:
1. Matcher preserves `allCandidates` longer than `candidates` when >3 matches exist
   (build a workbook with 4+ plausible columns/values); `candidates` unchanged vs
   Phase 4 expectations; `cleanCondition` strips `allCandidates`.
2. `startRefinement` dedupes and windows correctly.
3. Chips-round elimination: reject → next ranked candidates shown, rejected never
   reappear.
4. Discriminating question (columns): pool of 4+ column candidates spanning ≥2 concepts
   → group question with plain-word labels; `pickGroup` filters; then chips.
5. Discriminating question (values): value candidates across 2 columns → grouped by
   column.
6. One-group fallback: paging, no group question.
7. Single survivor is still a chips round (never auto-answer).
8. Exhaustion and the 6-round cap → `done: true`.
9. `logRefinement` privacy: seed value candidates with the example file's real cell
   values, serialize localStorage, assert no cell value string appears (mirror the
   Phase 3 alias-store privacy test); rounds render in `formatMisses`.

DOM — `src/phase5-refinement.dom.test.jsx`:
1. A stretched request shows the box with "None of these"; clicking it swaps in a NEW
   question (different candidates or a group question) — no answer card, no decline.
2. Picking a round-2 candidate answers, and the confirmed column alias persists (re-ask
   → no chip), same as Phase 3's test.
3. Exhausting every round shows the honest-stop notice, no answer card; with an API key
   set, the send-to-Claude affordance appears.
4. A >1-round success shows up in the miss-log export with its round count.

Also: run the FULL suite (`npm test`) — all Phase 1–4 banks must stay green — and
`npm run build` clean. Baseline is 621 tests; expect roughly +25–35.

Live check (dev server, port 5175, `.claude/launch.json` name "TidyTable dev server"):
on the built-in example file, type a stretch phrase that yields multiple candidates
(e.g. "average treatment length"), click "None of these", and confirm the second round
renders. Note what you saw in the handoff.

## G. Judgment calls already made (do not re-decide)

- **Operation-level discriminating question deferred.** The plan's example "count of
  patients, or an average of a number?" has no reachable state today — intent comes
  deterministically from wording and `needs_confirm` is always a column/value
  reference. Wiring a question no code path can ask would be dead code. Documented
  deferral, revisit when the Phase 6 bank surfaces a real operation-ambiguous phrasing.
- **Chart side untouched** (Phase 8's "one brain" is the vehicle).
- **No new candidates mid-loop** — elimination only (see invariant 2).
- **Value-candidate tail included in the pool** (§A.2): rejecting the strong ties makes
  lower-scored matches the honest next guesses; they were only hidden to keep round 1
  tight, not because they're wrong.
- **Group rounds are escapable** and escaping one = exhaustion (§E).

## H. Process requirements for the implementing agent

- Work in `/Users/joannehuang/Downloads/TidyTable` on branch `phase/5-refinement`
  branched from current `main` (2137e82). Commit there; do NOT merge or push.
- Phase 4's lesson: any helper inlined into the worker transform via `.toString()` must
  not reference module-level imports. (refine.js is UI-side and should never enter
  `fillPlan.js` — if you find yourself touching fillPlan, stop and re-read this doc.)
- Write the handoff `docs/archive/handoff-2026-07-10-offline-smarts-phase5.md` in the
  same format as the Phase 3/4 handoffs (what shipped, tests before/after, judgment
  calls, state checkpoint), and commit it on the branch.
- Match surrounding code style: comment density like matcher.js/concepts.js (explain
  the honesty stance, not the mechanics), no new dependencies, plain-English UI copy.
