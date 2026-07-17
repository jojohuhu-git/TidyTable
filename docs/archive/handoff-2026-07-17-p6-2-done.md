# TidyTable — Handoff after P6-2 done (2026-07-17)

> **SUPERSEDES** [handoff-2026-07-17-p6-1-done.md](handoff-2026-07-17-p6-1-done.md)
> — that handoff's open question ("P6-2 next, ask don't default") was asked
> and answered this session; P6-2 is now done.

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 28]` (this session's 1 commit, plus the 27 prior
commits already committed but never pushed).

Baseline this session was **926 passing (145 files)**, confirmed clean before
any new work, per the `resume` skill. Now **955 passing (147 files)**, all
green, working tree clean at commit `3fbca48`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section, step 5: `P6-1 → P6-2 → P6-4 → P6-3 → P6-5`, P6-1
and P6-2 now both done). PRIVACY: never read the owner's real files —
synthetic fixtures only; live-verified with the app's own "Try it with
example data" (fake) workbook.

## What's done this session

**P6-2** (histogram + box/dot distribution charts for numeric columns) —
`3fbca48`. Owner decision (asked, not defaulted, at the start of this
session): **P6-2 next**, over three other flagged candidates (Step-2
collapse-to-one-row-per-ID fix, the matcher.js silent-drop bug, the six-session-
stale Step 2 example chips) — all three are still open, see below.

A second judgment call surfaced mid-item and was resolved with the owner
before writing any code: the histogram's orientation. This app's existing
bar charts all grow rightward from left-hand labels (a deliberate, explicitly
documented house style, kept even for P6-1's crosstab). The owner chose
**vertical columns** for the histogram instead (the near-universal
statistics convention, since bins are a numeric axis, not named categories),
explicitly asking that both axes carry labels AND numeric ticks — a first
for this app, since every other chart (bar, line, pie, scatter) only labels
one axis or none at all. Box+dot kept the horizontal house style (long
clinical group names benefit from labels-on-the-left, same reasoning
CrosstabBarChart already used).

- `aggregate.js`: `computeHistogramBins(values)` — integer-friendly binning
  (a small whole-number range bins at 1 unit, so 5/7/10 get their own bars,
  never "4.5–6.5"; otherwise a "nice" wider bin via a standard 1/2/5/10 step
  rule, targeting ~10 bars). `buildHistogramDataset(sheet, valueCol, options)`
  — one numeric column, no grouping; unreadable cells counted honestly in
  `unreadableCount`, never dropped silently. `buildBoxDotDataset(sheet,
  labelCol, valueCol, options)` — per-group raw values + `computeNumericStats`
  (the SAME quartile/median function the Q&A "describe" answer already uses —
  one brain, no second implementation); dots kept only when a group has ≤50
  points (`BOXDOT_MAX_DOTS`), else box-only with an honest "n=N, box only"
  label; a group with zero readable numbers is excluded and named in
  `noDataGroups`, matching the existing average-by-group honesty pattern.
- `advisor.js`: `recommendDistribution(dataset)` dispatches on
  `dataset.shape` ("histogram" | "boxdot"), dispatched before the
  `!dataset.points` guard, same pattern as P6-1's crosstab branch.
  `boxDotAlternative(dataset)` — the spec's required cross-offer: any
  average/total-by-group bar chart (not a plain count) offers box+dot
  ("Averages hide spread — see the spread instead."), wired into both the
  many-categories and plain-categories bar branches; box+dot's own
  recommendation offers the average bar back.
- `textToChart.js`: `resolveHistogramSignal` — "distribution of X",
  "histogram of X", "spread of X", "X distribution", "X chosen" (the spec's
  own example, "durations chosen") — checked right after the crosstab
  signal, ahead of everything that assumes a grouping column. Explicitly
  skips a phrase containing a by/per/across marker ("spread of duration by
  ward") rather than silently dropping the group — that falls through to the
  existing average-by-group path unchanged. Box+dot has **no dedicated
  free-text trigger** — per spec, it's reached only via the advisor's
  cross-offer once an average/total-by-group bar is already drawn.
- `ChartPreview.jsx`: `HistogramChart` (new — vertical columns, labeled/ticked
  both axes, bin-rule caption) and `BoxDotChart` (new — horizontal boxes +
  whiskers + deterministic jittered dots, palette-colored per group, labeled/
  ticked value axis). Dispatch added at the top of the default export
  (`dataset.kind === "distribution"`), same short-circuit pattern as the
  crosstab branch.
- `chartAriaSummary.js` / `chartTitle.js` / `excelChart.js`: one branch each
  for the new `distribution` kind. Excel steps use Excel's **native**
  Histogram and Box and Whisker chart types (2016+, both platforms) — no
  manual-workaround helper table needed for the histogram; box+dot's Excel
  step is honest that Excel's native chart won't draw the individual dots,
  only this app's preview does.
- `ChartsPanel.jsx`: picking a numeric Value column with **no** Labels column
  now means "show me this number's distribution" (a histogram) rather than
  silently doing nothing — a new hint line says so explicitly. New `distMode`
  state ("boxdot" | null) toggles between the average-by-group bar and
  box+dot for the *same* label/value pair when the cross-offer alternative is
  clicked, cleared on every picker change so it never leaks into an unrelated
  pick. Removed the stale "no distribution charts (histograms) yet either"
  line from the Step 9 help panel.
- Tests: `src/logic/charts/p6-2-distribution-charts.test.js` (20 tests — bin
  math including the exact-integer-boundary edge cases, dataset shape/
  honesty, free-text resolution including the by-group-marker skip, advisor
  cross-offer both directions) and
  `src/components/p6-2-distribution-charts.dom.test.jsx` (9 tests — hand-
  picked histogram, free-text end to end, cross-offer round trip, Excel
  steps, tweak box hidden).
- **Bug found and fixed during live verification** (not a pre-existing test
  gap — this session's own new code): the box+dot chart's numeric x-axis
  ticks showed a dishonest "-1" for pure-positive duration data. Cause: the
  shared `niceMax(0)` helper returns `1` (by design, so a chart with an
  all-zero range still has *some* axis ceiling) — harmless in `BarChart`,
  which only conditionally draws a zero-reference *line* from that number
  and never prints it as text, but `BoxDotChart` also prints the axis as
  numeric tick *labels*, which surfaced the phantom value. Fixed by only
  reserving negative-axis space when a value is actually negative (see
  `hasNegative` guard in `ChartPreview.jsx`'s `BoxDotChart`). **Not fixed**:
  the same `niceMax(0)→1` quirk still exists in `BarChart` itself (line ~119)
  — currently invisible there since it never renders as text, but flagged
  below in case a future chart adds tick labels to `BarChart`'s scale too.
- Live-verified in the browser with the app's own synthetic example workbook
  (Encounters — after applying Step 2's 3 safe fixes so `Duration_days`
  becomes a clean number column): "distribution of Duration_days" free text
  correctly filled Value=Duration_days with Labels left empty, drew a
  vertical histogram with bars at 5/7/10 (matching the fixture's actual
  values) and labeled, ticked axes on both sides. Picking Diagnosis + average
  Duration_days by hand recommended a bar chart with "box and dot plot"
  correctly listed under Other options with the spec's exact reason text;
  clicking it redrew as a box+dot with real quartile boxes, a labeled/ticked
  value axis, and correctly excluded "cystitis" (whose only surviving row had
  an unreadable Duration_days) with the same honest "Not shown" message the
  average-bar path already uses; clicking back to "bar chart" round-tripped
  cleanly. Zero console errors throughout.

## NEW flag from this session (not fixed, not scoped — for a later pass)

The owner flagged, independent of the P6-2 work: **bar charts have
sufficient axis labeling, but some other chart types don't** — specifically
`LineChart` in `ChartPreview.jsx` (~line 234) has no y-axis value ticks and
no axis title text at all (it only labels x-axis category names under each
point), unlike `ScatterChart` which has both axis titles. This session's
P6-2 charts (`HistogramChart`, `BoxDotChart`) were both built WITH full
axis labeling per the owner's explicit ask, so they do not have this gap —
but `LineChart` and possibly `PieChart` (no axis at all, by chart-type
nature) still do. Bundle this with the `niceMax(0)→1` `BarChart` note above
when this gets picked up — both are "axis honesty" issues in the same
family, discovered/adjacent to the same code this session. Not scoped or
estimated — a fresh look should decide whether `LineChart` should also
switch to full tick labels like `ScatterChart`, or something lighter.

## What's NOT done — the remaining queue

Per the spec's execution order (steps 1–4 done in prior sessions; step 5 is
`P6-1 → P6-2 → P6-4 → P6-3 → P6-5`, P6-1 and P6-2 now done):

- **P6-4** (cohort-scoped charts — "of cystitis patients, …" carries a filter
  into a P6-1/P6-2 chart's title/caption; P3-3 highlight rules apply inside
  the cohort) — next per execution order. Depends on nothing left undone
  here; P6-2's dataset builders already accept the same `filter:
  {column, value}` option every other builder does, for exactly this.
- **P6-3** (Pareto cumulative-% line) and **P6-5** (small multiples) — after
  P6-4, per spec order.
- **LineChart / BarChart axis-labeling flag** — new this session, see above.
  Not scoped.
- **Step-2 collapse-to-one-row-per-ID fix** — flagged in the P6-1 handoff,
  still not built. Ask the owner before scoping/starting.
- **matcher.js silent-drop gap** — flagged in the P6-1 handoff: the shared
  Step-3 pipeline silently drops a second named column in some average/sum-
  by-group free-text requests instead of declining. Still not fixed. Flag
  before starting any work that touches average/sum grouping through free
  text (P6-4 will route some requests through this same pipeline).
- **P6/P5 items still queued from before this session** (unchanged): P5-1→
  P5-6 (publication exports), P5-4 (.docx/.pptx), P5-5 (ggplot2 figure code —
  must cover crosstab AND distribution chart types when it lands), P4-3
  (validation-list vocabularies, last per spec).
- **Step 2 StepHelpPanel example chips** — still not started; flagged in
  **seven** prior handoffs now (including this one), still true — ask before
  starting.
- **P1-4a's chart branch** — still deferred; recommended (not approved) to
  bundle with P6. Ask before starting either.

All decisions A–E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask those. The one judgment call above (histogram
orientation) was asked and answered this session — do NOT re-ask it either.

## Why this is a good stopping point

P6-2 is fully done across every surface the current app has: both dataset
builders, advisor reasoning (including the two-way cross-offer), SVG
preview with full axis labeling, aria summary, chart title, Excel steps
(using Excel's own native chart types), and both entry points (free text for
the histogram, hand-picked/cross-offer for box+dot). Tested at both the logic
and DOM layer, live-verified with real interaction including a genuine bug
catch-and-fix, zero console errors. P6-4 (cohort wording) is a clean next
unit with no dependency on anything left undone here.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **955 passing (147 files), all green**
   before any new work. If the counts differ, stop and diagnose.
3. Per execution order, the next item is **P6-4** (cohort-scoped charts) —
   but four other items are flagged above (the new axis-labeling flag, the
   Step-2 collapse fix, the matcher.js silent-drop gap, and the seven-session-
   stale Step 2 example chips). Ask the owner which to prioritize before
   defaulting to P6-4.
4. Load the dataviz skill before any P6-4 chart-styling work (same as P6-1
   and P6-2).
5. Follow the per-item workflow: reproduce → failing test (synthetic
   fixture, never the owner's real data) → confirm red → fix minimally →
   full suite green → live-verify anything UI-observable (start the dev
   server directly with `npm run dev` in `~/Downloads/TidyTable`, or via
   `preview_start`/`.claude/launch.json` "TidyTable dev server" — port 5175;
   if `preview_start` reports the 5-servers-per-folder cap, a server from a
   prior session is very likely already live on port 5175, reachable by
   `preview_start` with the plain `url` field instead of `name`) → commit
   named by item ID (e.g. `P6-4: ...`).
6. Push/deploy only on the owner's explicit say-so — including the 28
   commits already sitting locally ahead of origin.
