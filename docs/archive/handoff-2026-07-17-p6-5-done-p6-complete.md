# TidyTable — Handoff after P6-5 shipped: the whole P6 chart family is complete (2026-07-17)

> **STATUS: SUPERSEDED (2026-07-17, same day, later session-half).** The
> P5 zero-dependency export block (P5-1/P5-2/P5-3/P5-6) shipped right
> after this was written. Current handoff:
> [handoff-2026-07-17-p5-zero-dep-exports-done.md](handoff-2026-07-17-p5-zero-dep-exports-done.md)

> **SUPERSEDES** [handoff-2026-07-17-p6-5-design-only.md](handoff-2026-07-17-p6-5-design-only.md)
> — that file's design was executed this session, exactly as written. The
> canonical parked-items list is still
> `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` (unchanged).

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 36]`.

Baseline was 980 passing tests; now **995 passing (153 files)**, all green,
working tree clean (code) at commit `af9acea` — the only uncommitted files at
write time are this handoff, the superseded banner, and a prompting-guide
sync, committed together as a docs commit right after this file is written.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`.
PRIVACY: never read the owner's real files — synthetic fixtures only.

## What's done (by item ID)

1. **P6-5 — small multiples** (commit `af9acea`, 15 new tests). Exactly the
   superseded handoff's design:
   - `aggregate.js`: `SMALL_MULTIPLES_PANEL_CAP = 12`,
     `buildSmallMultiplesData(dataset)` → `{ panels, subgroups, maxValue,
     hiddenCount }`; one shared `maxValue` across only the SHOWN panels.
   - `advisor.js`: trigger = `categories.length > 12 && otherGrouped > 0`
     with no explicit layout ask → recommends `type: "smallMultiples"`, the
     3 bar layouts as alternatives. An explicit layout ask (typed layout
     word, or a clicked alternative) is honored with smallMultiples added as
     an alternative. Small crosstabs completely unchanged.
   - `ChartPreview.jsx`: `SmallMultiplesChart` — 3-column grid of mini
     horizontal-bar panels, shared Legend/Okabe-Ito palette, in-SVG
     "…and N more" note, aria `"Small multiples of …"`.
   - `excelChart.js`: `smallMultiplesSteps` — helper table + honest "Excel
     has no built-in small-multiples chart" step naming the two real routes
     (per-category charts by hand, or PivotChart + slicer). Shared
     folded-groups/filter steps extracted so wording can't drift from the
     P6-1 recipes.
   - `ChartsPanel.jsx`: "small multiples" type name, "first 12 of N" hint,
     FULL crosstab rendered as a `DataTable` below the panels.
   - Tests: `src/logic/charts/p6-5-small-multiples.test.js` +
     `src/components/p6-5-small-multiples.dom.test.jsx` (failing-first, then
     green). Live-verified in the browser with a synthetic 14-category ×
     10-drug CSV driven through the real upload input: recommendation card,
     panel grid, shared scale, cap note, full table, Excel steps, and
     round-trip switching small multiples ↔ grouped ↔ stacked. Zero console
     errors.
2. **docs/prompting-guide.md** — Step 9 section gained a "Small multiples
   (automatic)" bullet (the memory rule: keep the guide in sync when queue
   items ship).

Known nuance (intentional, per the executed design): a bare free-text
"X by Y" resolves with layout "grouped" (textToChart.js defaults it), so the
free-text path never AUTO-recommends small multiples — it appears there as a
one-click alternative. The auto-recommendation fires on the hand-picked
Labels + Split-by path, where no layout is implied.

## What's NOT done — the remaining queue

**P6 is now complete (P6-1 → P6-5).** Spec execution-order steps 1–5 and 7
are done; remaining, in the spec's own order:

- **Step 6: P5-1 → P5-2 → P5-3 → P5-6** — publication exports,
  zero-dependency parts first (every P6 chart type must ride these export
  paths, small multiples now included).
- **Step 8: P5-4 (.docx first, then .pptx) → P5-5** — Office exports and
  ggplot figure code. P5-5's templates must cover ALL P6 types incl. small
  multiples (facet_wrap is the ggplot analog).
- **Step 9: P4-3** — validation-list vocabularies (largest unknown, last).
- Everything in `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` —
  untouched; owner decides if any of it jumps the P5 queue. **Ask, don't
  default.**

## Why this is a good stopping point

P6-5 was the last item of the P6 chart family, shipped and live-verified as
one unit with nothing half-built. The next spec item (P5-1) opens a brand-new
workstream (publication exports) with its own owner-visible choices, so a
fresh session can start it clean from the spec text.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main`.
2. Run `npx vitest run` — expect **995 passing (153 files)** before any new
   work. If counts differ, stop and diagnose (cloud-sync reversion is the
   classic cause; check `git log` shows `af9acea`).
3. Owner decision at this fork: continue the spec order (**P5-1**,
   publication exports) or pull something from the parked list forward.
   Spec order says P5-1; the parked list's standing instruction is "ask
   before picking one of these instead". If the owner has said nothing,
   P5-1 is the recorded plan.
4. Per-item workflow: read the spec item → failing test first (synthetic
   fixture) → implement → full suite green → live-verify in the browser
   (`preview_start`, `.claude/launch.json` "TidyTable dev server") → commit
   named by item ID.
5. Push/deploy only on the owner's explicit say-so — including the 36 local
   commits already ahead of origin.
