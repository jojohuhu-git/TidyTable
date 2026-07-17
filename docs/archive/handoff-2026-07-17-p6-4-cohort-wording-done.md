# TidyTable — Handoff after P6-4 done (2026-07-17)

> **SUPERSEDED** by [handoff-2026-07-17-p6-3-done.md](handoff-2026-07-17-p6-3-done.md)
> — P6-3 (Pareto cumulative % line) is now done too. Read the newer file.

> **SUPERSEDES** [handoff-2026-07-17-p6-2-done.md](handoff-2026-07-17-p6-2-done.md)
> — that handoff asked the owner to prioritize between P6-4 and five flagged
> items before defaulting. The owner's instruction this session was explicit:
> do P6-4 next (the queue's next item per execution order), and leave all
> flagged/deferred items for a later pass — do not start them now. This
> handoff carries that same instruction forward unchanged.

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 30]` (this session's 1 commit, plus the 29 prior
commits already committed but never pushed).

Baseline this session was **955 passing (147 files)**, confirmed clean before
any new work, per the `resume` skill. Now **968 passing (149 files)**, all
green, working tree clean at commit `2d40d5a`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section, step 5: `P6-1 → P6-2 → P6-4 → P6-3 → P6-5` — P6-1,
P6-2, and now P6-4 all done). PRIVACY: never read the owner's real files —
synthetic fixtures only; live-verified with the app's own "Try it with
example data" (fake) workbook.

## What's done this session

**P6-4** (cohort-scoped charts get first-class wording) — `2d40d5a`. The
spec's own scope note said part (a) of the owner's cystitis example
("most common antibiotics among cystitis patients" — cohort filter + ranked
bar + top-bar emphasis) was already covered by prior work and just needed an
acceptance test; part (b) ("durations chosen for cystitis") was a real gap.
Both confirmed true by writing the tests against the pre-P6-4 baseline first
(via `git stash`): the ranked-bar cohort tests passed even before this
session's code changes; the histogram cohort tests and the new title/caption
tests failed as expected, then passed after the fix.

- `src/logic/charts/chartTitle.js`: `buildChartTitle` now appends
  `— <filter value> only` to whatever title it would otherwise build,
  whenever `dataset.filter` is set — generic across every dataset kind
  (categorical, crosstab, histogram, boxdot, xy), since `aggregate.js`
  already attaches `filter` to all of them. New `buildCohortCaption(dataset,
  filter)` states the exact filter and an honest `n` (read from whichever
  field each shape already tracks — `countTotal`, histogram `n`, summed
  group/category `n`, or `totalPoints` — never a second count); returns `""`
  with no filter, so nothing changes for the common unfiltered case (locked
  in by existing tests in `b9-chart-polish.test.js`, still green).
- `src/components/ChartsPanel.jsx`: the existing filter hint beside the
  pickers ("Only counting rows where...") now calls `buildCohortCaption`
  instead of a bare inline string, so it also states n — same location, same
  wording convention, just the honest number added.
- `src/logic/offline/matcher.js`: exported `detectTrailingValueCohort`
  (previously private) — the same "for/in/with/among X" cohort-clause parser
  Step 3's Q&A already uses for "average duration for UTI" (P1-2/R4), reused
  rather than reimplemented.
- `src/logic/charts/textToChart.js`: `resolveHistogramSignal` now strips a
  trailing cohort clause (via the newly-exported `detectTrailingValueCohort`)
  before matching the histogram patterns, so "durations chosen for cystitis"
  resolves to the histogram plan for `Duration_days` with
  `filter: {column: "Diagnosis", value: "cystitis"}` attached. Only fires
  when the phrase names a REAL, EXACT cell value (never-guess); gated behind
  a cheap `HISTOGRAM_TRIGGER` regex so the cost of building a value index is
  only paid on sentences that already look histogram-shaped.
  `finishHistogramPlan` threads the filter through instead of hardcoding
  `null`. `buildHistogramDataset` (aggregate.js) already accepted a `filter`
  option from P6-2 — no change needed there.
- Tests: `src/logic/charts/p6-4-cohort-charts.test.js` (11 tests — the
  ranked-bar cohort acceptance case with a fixture where the cystitis-only
  top drug deliberately differs from the whole-sheet top drug, proving the
  P3-3 callout is scoped to the filtered rows and not the whole sheet; the
  histogram cohort acceptance case with exact bin counts; a never-invent-a-
  filter honesty case; unfiltered title/caption regression checks) and
  `src/components/p6-4-cohort-charts.dom.test.jsx` (2 tests — both owner
  acceptance sentences typed into the real "Describe the chart" box end to
  end).
- Live-verified in the browser with the app's own synthetic example workbook
  (Encounters, after applying Step 2's 3 safe fixes): "among patients with
  cystitis, most common drug" drew a bar chart titled "count by Drug —
  cystitis only" with the caption "Only counting rows where 'Diagnosis' is
  'cystitis', n=1."; "durations chosen for UTI" (a richer 2-row cohort than
  the single-row cystitis one in this small fixture) drew a histogram titled
  "Distribution of Duration_days — UTI only" with matching n=2 caption and
  real bars at 5 and 10. The thin single-row cystitis cohort's own duration
  value happened to be missing in this fixture, which correctly produced
  "There is nothing to chart yet." with an honest n=0 caption rather than a
  fabricated bar — the honesty path also got exercised live, not just in
  tests. Zero console errors throughout both flows.

## What's NOT done — the remaining queue

Per the spec's execution order (steps 1–4 done in prior sessions; step 5 is
`P6-1 → P6-2 → P6-4 → P6-3 → P6-5`, all but P6-3/P6-5 now done):

- **P6-3** (Pareto cumulative-% line) and **P6-5** (small multiples) — next
  per execution order, after the owner picks among the flagged items below or
  says to proceed straight to P6-3.
- **Crosstab free-text cohort filter** — noticed but NOT built this session
  (out of scope for P6-4's acceptance criteria, which only required the
  ranked-bar and histogram paths): `finishCrosstabPlan` in textToChart.js
  still hardcodes `filter: null`, so "of cystitis patients, drug mix by ward"
  wouldn't resolve a filter via free text. A crosstab CAN already end up
  filtered today by a different route (type a filtered single-column
  request, then hand-pick a "Split by" column without clearing the filter —
  `buildCrosstabDataset` already accepts the `filter` option from P6-1, and
  the new title/caption code is generic enough to display it correctly if it
  gets there), so this is a free-text entry-point gap, not a display gap.
  Not scoped or estimated.
- **LineChart / BarChart axis-labeling flag** — flagged in the P6-2 handoff,
  still not built. Ask the owner before scoping/starting.
- **Step-2 collapse-to-one-row-per-ID fix** — flagged in the P6-1 handoff,
  still not built. Ask the owner before scoping/starting.
- **matcher.js silent-drop gap** — flagged in the P6-1 handoff: the shared
  Step-3 pipeline silently drops a second named column in some average/sum-
  by-group free-text requests instead of declining. Still not fixed. Flag
  before starting any work that touches average/sum grouping through free
  text.
- **P6/P5 items still queued from before this session** (unchanged): P5-1→
  P5-6 (publication exports), P5-4 (.docx/.pptx), P5-5 (ggplot2 figure code —
  must cover crosstab AND distribution chart types when it lands), P4-3
  (validation-list vocabularies, last per spec).
- **Step 2 StepHelpPanel example chips** — still not started; flagged in
  **eight** prior handoffs now (including this one), still true — ask before
  starting.
- **P1-4a's chart branch** — still deferred; recommended (not approved) to
  bundle with P6. Ask before starting either.

All decisions A–E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask those.

## Why this is a good stopping point

P6-4 is fully done across the surfaces it touches: title, caption (with
honest n), the free-text histogram entry point, and confirmed (via a test
that fails against the pre-P6-4 baseline and passes after) that the
ranked-bar cohort path already worked. Both owner acceptance sentences
verified live, including the honesty path (an empty cohort declines rather
than fabricating a bar). Tested at both the logic and DOM layer. P6-3
(Pareto) is a clean next unit with no dependency on anything left undone
here.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **968 passing (149 files), all green**
   before any new work. If the counts differ, stop and diagnose.
3. Per execution order, the next item is **P6-3** (Pareto cumulative-% line)
   — but six other items are flagged above. Ask the owner which to
   prioritize before defaulting to P6-3, same as the prior handoff asked
   (and the owner answered "do P6-4 next, flagged items last" this session).
4. Load the `dataviz` skill before any P6-3 chart-styling work (same as
   P6-1/P6-2).
5. Follow the per-item workflow: reproduce → failing test (synthetic
   fixture, never the owner's real data) → confirm red → fix minimally →
   full suite green → live-verify anything UI-observable (start the dev
   server directly with `npm run dev` in `~/Downloads/TidyTable`, or via
   `preview_start`/`.claude/launch.json` "TidyTable dev server" — port 5175;
   if `preview_start` reports the 5-servers-per-folder cap, a server from a
   prior session is very likely already live on port 5175, reachable by
   `preview_start` with the plain `url` field instead of `name`) → commit
   named by item ID (e.g. `P6-3: ...`).
6. Push/deploy only on the owner's explicit say-so — including the 30
   commits already sitting locally ahead of origin.
