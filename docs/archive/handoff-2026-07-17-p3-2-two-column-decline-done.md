> **SUPERSEDED** by
> [handoff-2026-07-17-p3-3-emphasis-done.md](handoff-2026-07-17-p3-3-emphasis-done.md)
> — P3-3 (the item this handoff left open next) is now done.

# TidyTable — Handoff after P3-2 (honest interim decline for two-column chart requests) done (2026-07-17)

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 16]` (this session's 1 commit, plus the 15 prior
commits already committed but never pushed).

Baseline this session was **842 passing (136 files)**, confirmed clean before
any new work, per the `resume` skill. Now **847 passing (137 files)**, all
green, working tree clean at commit `2496bcf`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section). PRIVACY: never read the owner's real files —
synthetic fixtures only.

## What's done this session

1. **P3-2** (honest interim decline for two-column chart requests, R7) —
   `2496bcf`. Bug: Step 9's "Describe the chart" box (`resolveChartLocally`
   in `src/logic/charts/textToChart.js`) resolved requests naming TWO real
   columns (e.g. "compare drug use between diagnoses", "Drug and Diagnosis",
   "drug by diagnosis") to a **one-column** chart marked **`confidence:
   "exact"`** — the second column was buried in an `ignored` footnote shown
   only *after* the (wrong-for-the-ask) chart was already drawn, not an
   upfront decline. Reproduced live via a throwaway script before touching
   any code; confirmed against `resolveChartRequest` directly.
   - Fix: in the leftover-handling step of `resolveChartLocally`, when
     `findValueCandidates` finds no value match, the code now calls
     `bestColumnSpan` against the remaining headers explicitly. If it finds
     a real second column (any score — the R7 case only scores 0.5 via the
     plural-fold tier, so a strict threshold would have missed it), the
     function returns `{ status: "none", reason: "two-column", message:
     "That compares two things at once (X and Y). I can chart one at a time
     for now; pick one, or use Step 7." }` instead of resolving. A stray
     leftover word that is NOT a real column (e.g. filler text) still falls
     back to the old soft `ignored` note — unchanged, still tested.
   - `src/logic/charts/textToChart.js`: the fix (see above).
   - Tests: 5 new in
     `src/logic/charts/fix-2026-07-11-p3-2-two-column-decline.test.js`
     (R7 itself, "Drug and Diagnosis", "drug by diagnosis" via explicit "by"
     marker, a non-regression single-column case, and a non-regression
     value-filter case that must NOT decline).
   - Updated 2 pre-existing tests whose expectations were superseded by this
     behavior change (both explicitly say so in their test names/comments,
     pointing at the new test file):
     - `src/logic/charts/honesty-2026-07-10.test.js` — "drug by diagnosis"
       used to resolve with `ignored: "drug"`; now correctly declines as
       two-column (it always named two real columns; the old test only
       checked the softer, pre-P3-2 honesty floor).
     - `src/logic/charts/phase4-topn-charts.test.js` — the "no ranking
       wording" test used "drugs by diagnosis" as an incidental fixture
       (its actual point was checking `rank` stays null); switched to bare
       "diagnosis" so it isn't accidentally testing the two-column path.
   - Live-verified in the browser (`http://localhost:5175/TidyTable/`,
     dev server already running from a prior session) against the built-in
     "Try it with example data" fixture (Encounters sheet, Drug + Diagnosis
     columns): typing "compare drug use between diagnoses" into Step 9 and
     clicking "Make this chart" shows the exact decline message, draws no
     chart, and leaves the hand-pickers empty. Typing "patients by
     diagnosis" (single real column) still resolves normally and draws the
     recommended bar chart with no regression. No console errors either way.

## What's NOT done — the remaining queue

- **P3-3** (next per execution order) — request-aware "smartly highlight"
  emphasis on Step 9 charts (highlight named value, auto-callout largest/
  smallest, threshold reference lines, value labels ≤12 categories). No
  owner decision pending; the spec's Decisions A–E + P4/P5/P6 already cover
  everything needed to start it.
- **Step 2 StepHelpPanel example chips** — still not started; not in P2-3's
  original scope, ask before starting (flagged in the P2-3 handoff, still
  true).
- **P1-4a's chart branch** — still deferred; recommended (not approved) to
  bundle with P6 since both need new `aggregate.js` grouping logic. Ask
  before starting either.
- **P6-1 / P6-2 / P6-4 / P6-3 / P6-5** — complex graphics (stacked/grouped/
  100% bars, histogram + box/dot, cohort wording, Pareto, small multiples).
  P6-1 is what eventually REPLACES P3-2's interim decline with real
  two-column charts — do not remove the P3-2 decline until P6-1 ships.
- **P5-1 / P5-2 / P5-3 / P5-6** then **P5-4 / P5-5** — publication exports.
- **P4-1 / P4-2 / P4-6 / P4-4** then **P4-3** — robustness/reach.

All decisions A-E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask them. No new judgment call came up this session that
wasn't already covered by the spec's existing decisions (the owner was asked
once, at the top of this session, only to pick which queue — P3-2 vs. the
Step 2 example-chip follow-on vs. "something else" — to work on next).

## Why this is a good stopping point

P3-2 closes the R7 dishonesty gap on its own, independent of P3-3 or P6: any
two-column chart request now gets an honest, plainly-worded decline instead
of a silently-wrong one-column chart, and the fix is narrowly scoped to the
leftover-handling branch that caused it (no other resolution paths touched).
It's fully tested (including a non-regression case and a value-filter case
that must NOT trigger the new decline) and live-verified end-to-end. Nothing
here blocks or was blocked by P3-3, P6, or any other queue.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **847 passing (137 files), all green**
   before any new work. If the counts differ, stop and diagnose.
3. Per the spec's execution order, the next item is **P3-3** (request-aware
   chart highlighting). No open owner decision is needed to start it. Ask
   the owner only if execution surfaces a new judgment call not already
   covered by Decisions A-E or this session's resolved calls.
4. Follow the per-item workflow: reproduce → failing test (synthetic
   fixture, never the owner's real data) → confirm red → fix minimally →
   full suite green → live-verify anything UI-observable (start the dev
   server directly with `npm run dev` in `~/Downloads/TidyTable`, since this
   repo's own `.claude/launch.json` config `"TidyTable dev server"` — port
   5175 — isn't picked up by `preview_start` when the harness's cwd is a
   different repo; or open the browser at `http://localhost:5175/TidyTable/`
   once `npm run dev` is running — a dev server may already be running from
   a prior session on this port) → commit named by item ID.
5. Push/deploy only on the owner's explicit say-so — including the 16
   commits already sitting locally ahead of origin.
