# TidyTable — Handoff after parked item 1 (crosstab cohort + partial-parse + chips) (2026-07-18)

> **SUPERSEDES** [handoff-2026-07-18-parked3-csn-mrn-phi-done.md](handoff-2026-07-18-parked3-csn-mrn-phi-done.md).
> The canonical parked-items list is still
> `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` (item 1 marked
> SHIPPED in place this session).

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb`:
`main...origin/main [ahead 49]` at commit `08f7dca`, working tree clean.

Baseline was 1098 passing tests; now **1112 passing (169 files)**, all green.

Repo: `~/Downloads/TidyTable`. Core promise: **never guess, never silently
drop data.** Folder is cloud-synced — commit locally often. PRIVACY: never
read the owner's real files — synthetic fixtures only.

## What's done (by item ID)

1. **Parked item 1** `08f7dca` — crosstab cohort filter + partial-parse
   honesty + example chips, all three scope parts (a)-(c) from the parked
   file:
   - (a) A new `detectLeadingValueCohort` in `src/logic/offline/matcher.js`
     (mirror of the existing `detectTrailingValueCohort`, exact-value-only,
     never guessed) strips a leading "of/for/in/with/among &lt;value&gt;
     patients/cases/rows/…," clause in `resolveChartRequest`
     (`src/logic/charts/textToChart.js`) BEFORE either resolution path runs.
     Both the shared Step 3 pipeline (single-column charts) and the local
     crosstab resolver now inherit the same filter — "of cystitis patients,
     drug mix by ward" scopes the crosstab; "of cystitis patients, most
     common drug" (single-column) benefits the same way. This closed a real
     gap: single-column charts didn't actually support this exact word order
     either, only the marker-first "among patients with X" form did.
   - (b) `resolveCrosstabSignal` now distinguishes a full match from a
     PARTIAL one (a structural "X mix by Y" pattern where a side doesn't
     resolve to a real column) and returns
     `{ status: "none", reason: "crosstab-partial", message, alternatives }`
     — 2-3 already-resolved plans built from real low-cardinality category
     columns (never an ID-like column, via a new `looksCategorical` helper).
     `ChartsPanel.jsx` renders these as clickable chips that apply the plan
     directly.
   - (c) `buildCrosstabExamplePrompts` in `src/logic/offline/examplePrompts.js`
     builds a plain crosstab chip and a cohort-filtered chip (filter value
     from a low-cardinality category column only). Each chip's plan is
     resolved ONCE at build time through the real `resolveChartRequest` and
     stored as-is — clicking calls `applyPlan(chip.plan)` directly, never
     re-parsing text (the owner's design rule).
   - 14 tests: `src/logic/charts/parked1-crosstab-cohort.test.js` (11) +
     `src/parked1-crosstab-cohort.dom.test.jsx` (3). Live-verified in the
     running app with the real "Try it with example data" fixture: the
     leading-cohort phrase scoped both a single-column and a two-column
     chart, the partial decline named the bad column and offered a working
     alternative chip, and the cohort example chip ("Drug by Diagnosis, only
     Duration_days: 5") drew the correctly filtered chart.
2. Owner guide `docs/prompting-guide.md` — Step 9's phrasing list and
   limitation #2 (previously "loses the cohort") updated to reflect the fix.

## What's NOT done — the remaining queue

Owner's recorded order (parked file header): item 4 ✓ → item 3 ✓ → item 1 ✓
→ **item 7 (NEXT, scoping only)**.

- **Parked item 7 (NEXT)** — plan-echo builder: SCOPING/DESIGN PASS ONLY, the
  owner must approve the design before any feature code is written. Scope in
  the parked file: four editable slots (Rows kept — ANDed conditions,
  Measure, Grouped by, Sorted) as dropdowns of real columns/values, a
  matching-row count and per-group n shown before running, free text
  pre-filling the form, the confirmed form executing in all output surfaces.
- **Parked items 2, 5, 6** — small/stale; owner hasn't prioritized them.
- **From the spec:** P5-4 Office exports (deps `pptxgenjs` + `docx`
  pre-approved 2026-07-11, lazy-load, check bundle size after build) and
  P5-5 (ggplot2 figure code — must cover crosstab, distribution, Pareto, and
  small-multiples types when it lands).

## Why this is a good stopping point

Item 1 shipped as one complete, verified unit — all three scope parts done,
suite green, live-verified. Item 7 is explicitly a scoping/design pass (no
code), a clean and independent next step that doesn't touch any of this
session's chart-pipeline changes.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main`.
2. `npx vitest run` — expect **1112 passing (169 files)**. If different, stop
   and diagnose (cloud-sync reversion is the classic cause; `git log` should
   show `08f7dca` as the tip).
3. No owner decision pending on ordering: the recorded order says item 7
   (scoping only) next. Only ask if the owner wants to reorder (e.g. pull
   P5-4 forward, or skip straight to a different parked item).
4. Item 7 is DESIGN ONLY — read its scope in
   `.claude/prompts/parked-2026-07-17-brainstormed-queue.md`, produce a
   written design proposal (the four slots, the row-count/per-group-n
   preview, how free text pre-fills the form), and get explicit owner
   approval before writing any feature code.
5. Push/deploy only on the owner's explicit say-so — 49 local commits will be
   ahead of origin.
