# TidyTable — Handoff after P6-3 done (2026-07-17)

> **SUPERSEDES** [handoff-2026-07-17-p6-4-cohort-wording-done.md](handoff-2026-07-17-p6-4-cohort-wording-done.md)
> — that handoff asked the owner to prioritize between P6-3 and six flagged
> items before defaulting. The owner's instruction this session was explicit:
> do P6-3 next (the queue's next item per execution order). The six
> flagged/deferred items below are still untouched — ask before starting any
> of them, same as every prior handoff has said.

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 32]` (this session's 1 commit, plus the 31 prior
commits already committed but never pushed).

Baseline this session was **968 passing (149 files)**, confirmed clean before
any new work, per the `resume` skill. Now **980 passing (151 files)**, all
green, working tree clean at commit `bf61c6d`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section, step 5: `P6-1 → P6-2 → P6-4 → P6-3 → P6-5` — all
but P6-5 now done). PRIVACY: never read the owner's real files — synthetic
fixtures only; live-verified with the app's own "Try it with example data"
(fake) workbook.

## What's done this session

**P6-3** (Pareto cumulative-% line for ranked count bars) — `bf61c6d`. Spec
text: "For any 'most common X' ranked bar, a one-click 'add cumulative %
line'... Off by default; caption states 'top 3 of 9 drugs account for 78%'."
The spec's own suggested layout (bars + a line on a right-hand secondary
axis) conflicts with the `dataviz` skill's non-negotiable rule against
dual-axis charts (two y-scales on one plot invent a correlation that isn't in
the data — the skill's own real-world example is cited as a "hallucinated"
chart). Resolved using the spec's own permitted alternative ("or the honest
twin-plot alternative if a second axis misleads"): the cumulative line is a
**separate panel** next to the bars, not overlaid on them — each panel has
exactly one axis (the bars' own count scale, and the new panel's own 0–100%
scale), sharing only the row order/height so they read together.

- `src/logic/charts/aggregate.js`: `buildParetoData(dataset)` attaches
  `cumValue`/`cumPct` to each already-sorted point (the running sum, not a
  second aggregation); declines (`null`) for a sum/average total, a
  time-series axis, or fewer than 2 categories — same "never guess" pattern
  as `describeExtreme`. `describeParetoSummary(paretoData)` states "Top K of
  N account for P%" at the standard 80% threshold — finds the smallest K
  whose cumulative share is `>= 80`, and because the last point's cumulative
  is always exactly the true total (100%), the search never falls short of a
  match; it never inflates past what the real data reaches (a flat 4-category
  distribution needs all 4 to cross 80%, and reports "100%", not a padded
  "80%"). Exported `PARETO_THRESHOLD` so the chart's own dashed 80% guide
  line and the caption's math can't drift apart (one brain).
- `src/components/ChartPreview.jsx`: `BarChart` takes a `pareto` prop
  (`buildParetoData`'s return value); when set, the SVG widens by a new
  `PARETO_STRIP_W` (150px) strip to the right of the bars with its own 0/50/
  100% ticks, a dashed vertical line at the 80% threshold, and one dot per
  row (aligned to the same `rowH`/row order as the bars) connected row-to-row
  by a line — a small-multiples "twin plot," never a second scale on the bars
  themselves. The aria-label now also states the Pareto caption via
  `chartAriaSummary.js`'s new `opts.paretoSummary`.
- `src/components/ChartsPanel.jsx`: new `paretoOn` state (default `false`,
  reset in `applyPlan` on every fresh text-driven chart). The toggle
  (`"Add cumulative % line (Pareto)"`) is offered only when
  `chartType === "bar"` and `buildParetoData(dataset)` is non-null — i.e.
  only for a "most common X" count bar, never a sum/average total, crosstab,
  or distribution chart (the twin panel only exists in `BarChart`). The
  caption renders as a `<p className="hint">`, the same convention already
  used for every other "state the honest number" callout in this file
  (`rankRequestedN`, `noDataGroups`, etc.).
- `src/logic/charts/excelChart.js`: `excelChartSteps` takes an optional 5th
  `pareto` arg. When set, a new "Add the cumulative % line" step names a
  helper "Cumulative %" column and Excel's own **native Pareto chart type**
  (Insert > Insert Statistic Chart > Histogram group > Pareto, Excel 2016+,
  Windows and Mac) — a trusted, non-hand-rolled dual-axis Excel builds and
  labels for you internally, the same reasoning already used for the native
  Histogram and Box-and-Whisker chart types elsewhere in this file.
- Tests: `src/logic/charts/p6-3-pareto-chart.test.js` (7 tests — cumulative
  math on an exact fixture where the 80% line falls precisely at the 3rd of
  6 categories, the sum/average/time-series/single-category decline cases,
  the "never inflate past 80%" case using a flat 4-category split that needs
  all 4 to cross the threshold, and the Excel step's presence/absence) and
  `src/components/p6-3-pareto-chart.dom.test.jsx` (5 tests — off by default,
  toggling on/off, hidden entirely for a sum/average bar, and the Excel step
  appearing only when the toggle is on).
- Live-verified in the browser with the app's own synthetic example workbook
  (Encounters, Drug column: cephalexin 3, amoxicillin 2, cefpodoxime 1):
  checking the toggle drew the twin panel with "Cumulative %" header, 50%/
  100% ticks, a dashed line at 80%, three dots climbing to 100%, and the
  caption "Top 2 of 3 account for 83%." — matching the hand-computed cumsum
  exactly (50% + 33% = 83%, which is the first point ≥ 80%). Unchecking
  reverted to the plain bar chart with no caption and no strip. Zero console
  errors throughout.

## What's NOT done — the remaining queue

Per the spec's execution order (steps 1–4 done in prior sessions; step 5 is
`P6-1 → P6-2 → P6-4 → P6-3 → P6-5`, now all but the last done):

- **P6-5** (small multiples) — next per execution order, the only remaining
  P6 item.
- **Crosstab free-text cohort filter** — flagged in the P6-4 handoff, still
  not built: `finishCrosstabPlan` in `textToChart.js` hardcodes `filter:
  null`, so "of cystitis patients, drug mix by ward" wouldn't resolve a
  filter via free text. Not scoped or estimated.
- **LineChart / BarChart axis-labeling flag** — flagged since the P6-2
  handoff, still not built. Ask the owner before scoping/starting.
- **Step-2 collapse-to-one-row-per-ID fix** — flagged since the P6-1
  handoff, still not built. Ask the owner before scoping/starting.
- **matcher.js silent-drop gap** — flagged since the P6-1 handoff: the
  shared Step-3 pipeline silently drops a second named column in some
  average/sum-by-group free-text requests instead of declining. Still not
  fixed. Flag before starting any work that touches average/sum grouping
  through free text.
- **P6/P5 items still queued from before this session** (unchanged): P5-1→
  P5-6 (publication exports), P5-4 (.docx/.pptx), P5-5 (ggplot2 figure code —
  must cover crosstab AND distribution chart types when it lands, and now
  Pareto/small-multiples too once P6-5 ships), P4-3 (validation-list
  vocabularies, last per spec).
- **Step 2 StepHelpPanel example chips** — still not started; flagged in
  **nine** prior handoffs now (including this one), still true — ask before
  starting.
- **P1-4a's chart branch** — still deferred; recommended (not approved) to
  bundle with P6. Ask before starting either.

All decisions A–E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask those.

## Why this is a good stopping point

P6-3 is fully done across the surfaces it touches: the twin cumulative
panel, the aria summary, the caption, and the Excel recipe (via Excel's own
native Pareto chart type). The dual-axis conflict between the spec's
suggested layout and the `dataviz` skill's non-negotiable was resolved
explicitly and tested against an exact fixture, not eyeballed. P6-5 (small
multiples) is a clean next unit with no dependency on anything left undone
here — it's the last item in the P6 execution order.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **980 passing (151 files), all green**
   before any new work. If the counts differ, stop and diagnose.
3. **Owner decision (2026-07-17, this session): do P6-5 next.** The six
   flagged items below stay parked, untouched, pending owner review — do NOT
   pick one up instead of P6-5, and do not default to one once P6-5 is done
   either; come back and ask.
4. Load the `dataviz` skill before any P6-5 chart-styling work (same as
   P6-1/P6-2/P6-3) — and note the P6-3 precedent above: when a spec's
   suggested chart layout conflicts with the skill's non-negotiables, resolve
   it explicitly (state the conflict, pick the compliant alternative, test
   it) rather than picking one silently.
5. Follow the per-item workflow: reproduce → failing test (synthetic
   fixture, never the owner's real data) → confirm red → fix minimally →
   full suite green → live-verify anything UI-observable (start the dev
   server directly with `npm run dev` in `~/Downloads/TidyTable`, or via
   `preview_start`/`.claude/launch.json` "TidyTable dev server" — port 5175;
   if `preview_start` reports the 5-servers-per-folder cap, a server from a
   prior session is very likely already live on port 5175, reachable by
   `preview_start` with the plain `url` field instead of `name`) → commit
   named by item ID (e.g. `P6-5: ...`).
6. Push/deploy only on the owner's explicit say-so — including the 32
   commits already sitting locally ahead of origin.
