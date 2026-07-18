# TidyTable — Handoff after P6-5 design pass, no code written yet (2026-07-17)

> **STATUS: SUPERSEDED (2026-07-17, later session).** The design below was
> executed as written — P6-5 shipped in commit `af9acea`, full suite 995
> passing. Do NOT re-run this queue. Current handoff:
> [handoff-2026-07-17-p6-5-done-p6-complete.md](handoff-2026-07-17-p6-5-done-p6-complete.md)

> **SUPERSEDES** [handoff-2026-07-17-p6-3-done.md](handoff-2026-07-17-p6-3-done.md)
> for "what's next" purposes — that handoff's owner decision ("do P6-5 next")
> is unchanged and still the right call; this file just carries the design
> forward so the next session doesn't have to re-derive it. The canonical
> parked-items list is still
> `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` — nothing there
> changed either.

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 35]` (unchanged from last session — this session
wrote no commits).

Baseline confirmed this session: **980 passing (151 files)**, all green,
working tree **clean** at commit `7491187` (the doc-only commit from the
previous session — docs/prompting-guide.md + the consolidated parked-items
file). **This session made zero code or doc changes** — it was entirely
reading and design work for P6-5, described below. No new commit exists.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" step 5: `P6-1 → P6-2 → P6-4 → P6-3 → P6-5` — P6-5 is the
last item). PRIVACY: never read the owner's real files — synthetic fixtures
only.

## What's done this session

Nothing shipped. What happened: read the P6-5 spec text, read the P6-1
crosstab architecture (`aggregate.js` `buildCrosstabDataset`, `advisor.js`
`recommendCrosstabLayout`, `ChartPreview.jsx` `CrosstabBarChart`,
`chartAriaSummary.js` `buildCrosstabAriaSummary`, `excelChart.js`
`crosstabSteps`, `chartTitle.js`), loaded the `dataviz` skill (required
before P6 chart-styling work, same as every prior P6 item), and designed the
approach below. Also confirmed the dataviz skill's own non-negotiable
directly supports this design: *"A 9th series is never a generated hue — it
folds into 'Other,' small multiples, or composite encoding."*

Started the TidyTable dev server via `preview_start` (serverId
`7e74b6dd-19c2-4867-ad79-d0995d155920`, port 56683 — port 5175 was already
occupied by a server from an earlier session).

### The design (not yet built)

**Trigger condition** — reuses fields the crosstab dataset already computes,
no new field needed: `dataset.categories.length > MANY_CATEGORIES (12) &&
dataset.otherGrouped > 0`. `otherGrouped` is already truthy exactly when the
raw subgroup count exceeded the 8-color cap (`aggregate.js` line ~356) — so
this condition IS the spec's "> ~12 labels × > 8 subgroups" with no new
dataset plumbing.

**Advisor (`advisor.js`)**: in `recommendCrosstabLayout`, when the trigger
fires AND the request carried no explicit layout ask
(`!CROSSTAB_LAYOUTS.includes(opts.requestedLayout)`), recommend a new `type:
"smallMultiples"` instead of grouped/stacked/stacked100, with the 3 existing
layouts offered as alternatives (never refuse — same house pattern as the
"many categories" horizontal-bar override for single-axis charts). If the
request DID explicitly ask for a layout (typed "stacked", or the user
previously clicked an "Other options" alternative), honor it as before, but
add `smallMultiples` as one more alternative on that recommendation so the
reader can still escape to it. This preserves the existing
`ChartsPanel.jsx` "Other options" click-to-switch mechanism with no changes
needed there (the `isActive` check is already generic to non-"bar" types —
verified against how `boxdot`/`histogram` alternatives already work).

**Dataset shaping (`aggregate.js`)**: new `SMALL_MULTIPLES_PANEL_CAP = 12`
and `buildSmallMultiplesData(dataset)` — slices `dataset.categories` to the
cap (categories are already sorted largest-total-first), computes one
shared `maxValue` across only the shown panels' subgroup values (so panel
bar lengths are honestly comparable panel-to-panel, not each independently
rescaled), and returns `{ panels, subgroups, maxValue, hiddenCount }`.

**Chart (`ChartPreview.jsx`)**: new `SmallMultiplesChart` component — a grid
of mini bar-chart panels (one per category, each panel's own mini horizontal
bars for its subgroup breakdown), reusing the existing `Legend` component
for the shared subgroup color key, one shared value-axis scale across all
panels per `buildSmallMultiplesData`. Dispatch added in the top-level
`ChartPreview`: when `dataset.kind === "crosstab" && chartType ===
"smallMultiples"`, render `SmallMultiplesChart` instead of
`CrosstabBarChart`. Aria summary reuses the existing
`buildCrosstabAriaSummary` (already caps categories/subgroups honestly for
screen readers) with a `"Small multiples of …"` prefix instead of `"Bar
chart of …"`.

**Excel recipe (`excelChart.js`)**: new `smallMultiplesSteps(dataset)` —
reuses the existing `crosstabHelperTableStep` for the underlying numbers,
then states plainly that Excel has no universally-available native
small-multiples chart type (unlike the histogram/box-and-whisker cases,
where a real native chart type could be named confidently) — the honest
recipe is either building one small bar chart per category by hand from the
helper table, or a PivotChart with a slicer on the label column to flip
through categories one at a time. Wire into the `excelChartSteps` dispatcher
alongside the existing `crosstabSteps`/`histogramSteps`/`boxDotSteps`
branches.

**Panel wiring (`ChartsPanel.jsx`)**: add `"smallMultiples": "small
multiples"` to the `chartTypeName` map. Below the `SmallMultiplesChart`
preview, render the FULL crosstab (not capped at 12) as a `DataTable`
(reusing the existing `src/components/DataTable.jsx` — it already has its
own honest "showing first N of M rows" cap message, so no new capping logic
needed) with `columns = [labelName, ...subgroups]`, one row per category —
this is the "…and N more + the full table" the spec asks for, built from a
component that already exists rather than a new one.

## What's NOT done — the remaining queue

- **P6-5 itself** — 100% of the implementation above is unbuilt. Next
  session should follow the per-item workflow (reproduce/design already
  done above → write the failing test file first → implement → full suite
  green → live-verify → commit `P6-5: ...`). Suggested test file names,
  matching the P6-1/P6-3 convention: `src/logic/charts/p6-5-small-multiples.test.js`
  (aggregate.js + advisor.js) and `src/components/p6-5-small-multiples.dom.test.jsx`
  (ChartPreview + ChartsPanel, including switching to/from grouped via
  "Other options").
- Everything in `.claude/prompts/parked-2026-07-17-brainstormed-queue.md`
  (crosstab cohort filter + chips, axis-labeling flag, Step-2 CSN/MRN
  handling + PHI mode, matcher.js silent-drop, Step-2 example chips,
  P1-4a's chart branch, the new plan-echo builder) — **all untouched,
  owner's standing instruction is P6-5 first, ask before picking one of
  these instead.**
- P5-1→P5-6 (publication exports), P5-4 (.docx/.pptx), P5-5 (ggplot2 figure
  code — must cover crosstab/distribution/Pareto/small-multiples chart
  types once P6-5 ships), P4-3 (validation-list vocabularies, last per
  spec) — unchanged, queued after P6-5 per the spec's execution order.

## Why this is a good stopping point

No code exists yet, so there is nothing partially built to leave in a broken
state — the design above is complete and self-contained (every touched file
identified, every new function named, the trigger condition reuses existing
dataset fields with no new plumbing). A fresh session can go straight to
"write the failing test" with no re-reading of `advisor.js`/`aggregate.js`
required, only a skim to confirm nothing shifted since this was written.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **980 passing (151 files), all green**
   before any new work. If the counts differ, stop and diagnose (nothing
   should have changed since this handoff was written).
3. No owner decision is pending — P6-5 next is already confirmed (see the
   superseded handoff). Proceed directly to building it per the design
   above.
4. The `dataviz` skill is already loaded/reasoned about in this handoff; the
   one non-negotiable it flags that applies here is already satisfied by
   the small-multiples approach itself (folding an over-large series count
   into small multiples, per the skill's own rule, rather than a 9th
   generated hue).
5. Follow the per-item workflow: write the failing test first (synthetic
   fixture — build a crosstab sheet with >12 categories and >8 subgroups so
   `otherGrouped` is set and the trigger fires; the P6-1/P6-3 test files
   show the `deriveSheet(...)` fixture pattern to copy) → confirm red →
   implement in the order listed above (aggregate.js → advisor.js →
   ChartPreview.jsx → excelChart.js → ChartsPanel.jsx) → full suite green →
   live-verify in the browser (dev server already running this session at
   port 56683, or start fresh via `preview_start`/`.claude/launch.json`
   "TidyTable dev server") → commit `P6-5: ...`.
6. Push/deploy only on the owner's explicit say-so — including the 35
   commits already sitting locally ahead of origin.
