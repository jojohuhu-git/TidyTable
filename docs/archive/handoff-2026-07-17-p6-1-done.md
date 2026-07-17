# TidyTable — Handoff after P6-1 done (2026-07-17)

> **SUPERSEDES** [handoff-2026-07-17-p4-4-done.md](handoff-2026-07-17-p4-4-done.md)
> — that handoff's open question ("P6 next, ask don't default") was asked
> and answered this session; P6-1 is now done.

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 26]` (this session's 1 commit, plus the 25 prior
commits already committed but never pushed).

Baseline this session was **912 passing (143 files)**, confirmed clean before
any new work, per the `resume` skill. Now **926 passing (145 files)**, all
green, working tree clean at commit `e78211a`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section, step 5: `P6-1 → P6-2 → P6-4 → P6-3 → P6-5`, P6-1
now done). PRIVACY: never read the owner's real files — synthetic fixtures
only; live-verified with the app's own "Try it with example data" (fake)
workbook.

## What's done this session

**P6-1** (grouped/stacked/100% stacked bars for two categorical columns) —
`e78211a`. Owner decision (asked, not defaulted, at the start of this
session): **P6-1 next**, over the smaller Step-2 example-chips item that has
been sitting flagged for five sessions running (still flagged, see below).

A second judgment call surfaced mid-item and was resolved with the owner:
the spec's "per-patient vs per-row grain memory applies" honesty guardrail
does **not** get new wiring for two-column crosstab charts this session —
they inherit the same no-check behavior every existing single-column
breakdown chart already has. The owner's own framing of the underlying
problem (cleaning to unique encounters vs. unique patients depends on
project scope) pointed to a **better-scoped future fix**: an optional
collapse-to-one-row-per-ID fix offered at Step 2's existing "repeated values
in an ID-like column" finding, rather than a scattered per-chart-request
question. Logged below, not built.

- `aggregate.js`: new `buildCrosstabDataset(sheet, labelCol, subgroupCol,
  options)` — counts only (no sum/average), categories sorted largest-total-
  first, subgroups capped at the Okabe-Ito 8 with the smallest folded into
  one "Other (`N` smaller groups)" bucket, same naming convention as the
  existing single-axis `groupSmallIntoOther`.
- `advisor.js`: `recommendChart(dataset, { requestedLayout })` — crosstab
  branch picks grouped/stacked/stacked100 from the hint (defaulting to
  grouped), states the reason out loud, offers the other two as
  alternatives.
- `textToChart.js`: R7 flip — the P3-2 interim decline
  (`fix-2026-07-11-p3-2-two-column-decline.test.js`) is gone for genuine
  two-categorical-column requests. New `resolveCrosstabSignal` (sentence
  patterns for "X mix by Y" / "breakdown of X within each Y" / "X by Y
  stacked" / "compare X between Y") runs before the single-column pipeline;
  the pre-existing bare "X by Y" / "X and Y" leftover-second-column path now
  builds a crosstab (default layout "grouped") instead of declining, unless
  a numeric value column was already claimed (a genuine third variable still
  declines, naming every column, e.g. "average duration by diagnosis per
  ward").
- `ChartPreview.jsx`: new `CrosstabBarChart` — grouped/stacked/100%-stacked
  horizontal bars (kept the app's one existing bar orientation rather than
  introducing vertical columns), a mandatory legend (Okabe-Ito swatches,
  wraps at 4/row), and `n=` appended to each category's label in 100%-stacked
  mode so percent scaling never hides the real sample size.
- `chartAriaSummary.js`: `buildCrosstabAriaSummary` for the screen-reader
  label.
- `excelChart.js`: `crosstabSteps` — a helper crosstab table (label x
  subgroup counts), "Clustered/Stacked/100% Stacked Column" insert step, an
  explicit "turn on the legend" step, a percent-axis check for 100%-stacked,
  and an "Other"-folding note when subgroups were capped.
- `chartTitle.js`: crosstab title is `"<subgroup> by <label>"`.
- `ChartsPanel.jsx`: new "Split by (optional)" dropdown next to Labels/Value
  (mutually exclusive with Value — picking one clears the other); the
  "Other options" alternatives list now distinguishes crosstab layouts (not
  just chart type); the word-tweak box ("only top 5", "sort alphabetically",
  etc.) is hidden for a crosstab rather than silently no-opping while
  claiming success, since none of those verbs apply to it yet.
- Tests: `src/logic/charts/p6-1-grouped-stacked-charts.test.js` (crosstab
  dataset math, subgroup capping, all four free-text phrasings, the
  three-variable decline, advisor reasoning) and
  `src/components/p6-1-grouped-stacked-charts.dom.test.jsx` (hand-picked
  Split-by flow, layout switching via Other options, Excel steps, tweak-box
  hidden, end-to-end free text). Updated two pre-existing tests
  (`fix-2026-07-11-p3-2-two-column-decline.test.js`,
  `honesty-2026-07-10.test.js`) whose assertions the flip intentionally
  falsified — old decline assertions replaced with the new resolved-crosstab
  assertions, non-regression cases kept.
- Live-verified in the browser with the app's own synthetic example workbook
  (Encounters: Diagnosis x Drug): "drug mix by diagnosis" free text
  correctly filled Labels=Diagnosis, Split by=Drug, recommended "100%
  stacked bar chart" with the stated reason, and drew a legend + `n=`
  labels + percent axis that matched the underlying counts by hand. Clicking
  "Other options" → "grouped bar chart" correctly redrew as clustered bars
  at the right relative widths. No console errors either time.

**Not fixed, flagged for a later session (pre-existing, not introduced by
P6-1):** a probe during this session found that
`"average duration_days by ward and diagnosis"` resolves through the
*other* code path (the shared Step-3 pipeline, `matcher.js`, `via: "step3"`)
and silently drops "ward", marking the result "exact" — the same shape of
bug R7 patched in `textToChart.js`'s local parser, but in different,
untouched code. Not fixed here — flag it to the owner before relying on
multi-column averages/sums through free text.

## What's NOT done — the remaining queue

Per the spec's execution order (steps 1–4 done in prior sessions; step 5 is
`P6-1 → P6-2 → P6-4 → P6-3 → P6-5`, P6-1 now done):

- **P6-2** (distribution charts — histogram, box+dot) — next per execution
  order. Load the dataviz skill first, same as P6-1.
- **P6-4** (cohort-scoped charts — "of cystitis patients, …" carries a
  filter into a P6-1/P6-2 chart's title/caption; P3-3 highlight rules apply
  inside the cohort) — after P6-2.
- **P6-3** (Pareto cumulative-% line) and **P6-5** (small multiples,
  eventually replaces P3-2's residual behavior for very busy two-variable
  requests) — after P6-4, per spec order.
- **NEW follow-up (this session, not built)**: an optional "collapse to one
  row per [ID]" fix offered at Step 2's existing ID-repeat finding, letting
  the owner apply her own judgment about project scope (unique encounters
  vs. unique patients) at cleaning time — fixes the grain once for every
  downstream surface (Q&A, all charts, exports) instead of a per-chart
  question. Ask the owner before scoping/starting.
- **NEW follow-up (this session, not fixed)**: the shared Step-3 pipeline
  (`matcher.js`) silently drops a second named column in some
  average/sum-by-group free-text requests instead of declining — same bug
  class as R7, different code path. Flag before starting any P6-2/P6-4 work
  that touches average/sum grouping, since P6-4 will also route requests
  through this pipeline.
- **P6/P5 items still queued from before this session** (unchanged):
  P5-1→P5-6 (publication exports), P5-4 (.docx/.pptx), P5-5 (ggplot2 figure
  code — must cover the new P6-1 crosstab types when it lands), P4-3
  (validation-list vocabularies, last per spec).
- **Step 2 StepHelpPanel example chips** — still not started; flagged in
  **six** prior handoffs now (including this one), still true — ask before
  starting.
- **P1-4a's chart branch** — still deferred; recommended (not approved) to
  bundle with P6. Ask before starting either.

All decisions A–E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask those. The two judgment calls above (grain memory
scope, P6-1-vs-chips ordering) were asked and answered this session — do
NOT re-ask those either.

## Why this is a good stopping point

P6-1 is fully done across every surface the current app has: dataset,
advisor reasoning, SVG preview with a mandatory legend, aria summary, Excel
steps, and both entry points (free text and hand-picked "Split by"). Tested
at both the logic and DOM layer, live-verified with real interaction (not
just a render check), zero console errors. The two things it does NOT cover
(P5 export surfaces, P5-5 ggplot code) don't exist yet for ANY chart type,
single-column included — so P6-1 isn't a partial fix, it's complete for the
surfaces that exist today. P6-2 (distributions) is a clean next unit with no
dependency on anything left undone here.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **926 passing (145 files), all green**
   before any new work. If the counts differ, stop and diagnose.
3. Per execution order, the next item is **P6-2** (distribution charts) —
   but two follow-ups were flagged above (Step-2 collapse fix, the
   matcher.js silent-drop gap) and the Step-2 example-chips item is still
   six sessions stale. Ask the owner which to prioritize before defaulting
   to P6-2.
4. Load the dataviz skill before any P6-2 chart-styling work (same as P6-1).
5. Follow the per-item workflow: reproduce → failing test (synthetic
   fixture, never the owner's real data) → confirm red → fix minimally →
   full suite green → live-verify anything UI-observable (start the dev
   server directly with `npm run dev` in `~/Downloads/TidyTable`, or via
   `preview_start`/`.claude/launch.json` "TidyTable dev server" — confirmed
   working this session at port 54507) → commit named by item ID (e.g.
   `P6-2: ...`).
6. Push/deploy only on the owner's explicit say-so — including the 26
   commits already sitting locally ahead of origin.
