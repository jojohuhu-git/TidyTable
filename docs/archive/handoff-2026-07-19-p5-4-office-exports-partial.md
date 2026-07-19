# TidyTable — Handoff after item 7 + P5-4 Office exports, partial (2026-07-19)

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live
site at https://jojohuhu-git.github.io/TidyTable/). `git status -sb`:
`main...origin/main [ahead 67]` at commit `a97c74d`, working tree clean.

Baseline at session start was 1173 passing tests (item 7 had just shipped,
per the tail commit `94e873a` — but no handoff was written for that
session, a gap this file also covers). Now **1197 passing (184 files)**,
all green.

Repo: `~/Downloads/TidyTable`. Core promise: **never guess, never silently
drop data**.

## What's done (by item ID)

- **Item 7 (plan-echo builder)** — already SHIPPED before this session
  started (commit `94e873a`, no handoff was written then). Verified this
  session: the "Build a surefire plan" panel under Step 9 is real and
  tested (AND/OR filter groups, count/sum/average/median measure, one- or
  two-column grouping with crosstab+measure support, saved sort, live
  match-count preview, literal summary line, free-text pre-fill), shipped
  across the in-app chart, Excel recipe, and a new R script generator. Full
  scope: `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` §7.

- **P5-4 (Office exports) — SHIPPED, PARTIAL** this session, docx-first per
  the spec's execution order. Commits `7cba56d`..`2801a48`:
  1. `7cba56d` — installed `docx@9.7.1` + `pptxgenjs@4.0.1`, both
     dynamically imported only inside their export functions (never a
     module top level), so neither enters the main bundle until used.
  2. `807fe5b` — `buildJournalTable` (`src/logic/export/docxTable.js`): a
     real docx table with three horizontal rules (above header, below
     header, below last row), zero vertical lines. Tests inspect the
     actual generated OOXML via `Packer.toBuffer` + `jszip`, not the
     docx.js object shape.
  3. `03dacb7` — "Send to Word" on any result card (`ResultsPanel.jsx`),
     downloading the exact row-level table already on screen (same rows as
     Excel/CSV) as a .docx — **not** an aggregated mean(SD)/n(%)-per-
     variable "Table 1" (owner's explicit 2026-07-19 scope call, see
     below).
  4. `e02f6ec` — **P4-5**, "Export all results to Word" (committee
     report): one Word doc from every result card, oldest first, a page
     break between tables; a compound "and" question expands into one
     section per part; stale/empty cards skipped. Ships as part of P5-4
     per the spec (same dependency, same code path).
  5. `2801a48` — "Send to PowerPoint" on a chart (`ChartsPanel.jsx` +
     `exportPptx.js`): one 16:9 slide with title, the chart image (reuses
     P5-1's `svgToPngBlob`), and the n= footnote.
  6. `a97c74d` — docs: `docs/prompting-guide.md` (new export bullets +
     limitations item 7) and the parked-queue file (P5-4 section marks
     what shipped vs. what was deferred, and why).

  27 new/updated tests total. Every OOXML/pptx assertion inspects the real
  generated zip (via `jszip`) rather than trusting the JS builder's object
  shape. Live-verified in the running dev server: a Send-to-Word download,
  a two-table Export-all-results report, and a Send-to-PowerPoint download
  all produced real files with correct MIME types and no console errors.

## What's NOT done — the remaining queue

- **P5-5** (ggplot2 R code generator) — not started. Must cover crosstab,
  distribution, Pareto, and small-multiples chart types when it lands, per
  the original spec. This is the only item left from the 2026-07-11 spec.

- **Deferred P5-4 sub-items — the owner explicitly declined these
  2026-07-19, do not build without asking again:**
  1. An **aggregated summary-statistics "Table 1"** (one row per variable,
     n (%) for categories, mean (SD) for numbers, computed across the
     whole dataset). This is a materially different, unbuilt aggregation
     feature — not an export-format tweak on what already ships.
  2. An **"Export all results" PowerPoint deck** (one slide per result
     card). Unlike the Word committee report, a result card has no
     rendered chart to put on a slide — only Step 9 renders one chart at a
     time. Building this needs a new off-screen chart-rendering pipeline
     (resolve each card's data into a dataset, draw it, rasterize it) that
     doesn't exist today.

Full detail on both the shipped and deferred parts:
`.claude/prompts/parked-2026-07-17-brainstormed-queue.md` §"P5-4. Office
exports".

## Why this is a good stopping point

Every P5-4 commit is independently green (full suite run after each
step) and live-verified. The two deferred items are genuinely separable —
neither blocks P5-5 or anything else in the app. P5-5 is next per the
owner's recorded order and has no open scope questions of its own yet
(the spec already states its acceptance criteria: cover crosstab,
distribution, Pareto, small-multiples).

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main`
2. Run `npm test -- --run` — confirm **1197 passing (184 files)** before
   any new work. Start the dev server via `preview_start` +
   `.claude/launch.json` ("TidyTable dev server", port 5175) for live
   verification.
3. No open decision blocks P5-5 — go straight to scoping/building it,
   following the spec's acceptance criteria (crosstab, distribution,
   Pareto, small-multiples coverage, same title/labels/Okabe-Ito colors as
   the in-app chart, ending in `ggsave(..., dpi = 300)`).
4. Per-item workflow: failing test first (synthetic fixtures only, never
   the owner's real files), fix, full suite green, live-verify in the
   running app, commit per logical step (mirror this session's
   `P5-4 step N: ...` commit style), update
   `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` and
   `docs/prompting-guide.md`'s limitations section in the same commit that
   ships.
5. **Do not push** — commit locally only; the owner reviews and pushes
   herself when ready.
