# TidyTable — Handoff after the zero-dependency P5 export block (2026-07-17, evening)

> **SUPERSEDES** [handoff-2026-07-17-p6-5-done-p6-complete.md](handoff-2026-07-17-p6-5-done-p6-complete.md)
> — same day, later session-half. Everything that handoff called done is
> still done; this one adds P5-1/P5-2/P5-3/P5-6 on top. The canonical
> parked-items list is still
> `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` (untouched).

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live
site at https://jojohuhu-git.github.io/TidyTable/). `git status -sb`:
`main...origin/main [ahead 41]` at commit `d3d682f`, working tree clean
apart from this handoff + a prompting-guide sync (committed together as a
docs commit right after this file).

Suite: **1039 passing (161 files)**, all green (was 980 at the session's
start, 995 after P6-5).

Repo: `~/Downloads/TidyTable`. Core promise: **never guess, never silently
drop data.** Folder is cloud-synced — commit locally often. Queue/spec:
`.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`. PRIVACY:
never read the owner's real files — synthetic fixtures only.

## What's done this session-half (by item ID, one commit each)

1. **P6-5** `af9acea` — small multiples (see the superseded handoff for detail).
2. **P5-1** `429934d` — zero-dependency exports: Copy chart (clipboard PNG,
   honest failure messages), Download SVG (new `exportChart.js`
   `serializeChartSvg` inlines computed styles so `var(--accent)` fills and
   fonts survive outside the app — the PNG download now shares this),
   Copy table for Word (`tableHtml.js`, text/html + text/plain, covers
   Table 1 via ResultsPanel; copies ALL rows, not the 200 shown).
3. **P5-2** `27e4756` — purpose-sized PNG export (`exportPresets.js`):
   Slide (fit 1920×1080), Poster (300 dpi × chosen inches, default 8),
   Journal single (3.5in) / double (7in) column; live warning when the
   chosen size prints the 11px axis text under ~8pt (single column → 5.8pt
   warns, by design); "What do these sizes mean?" plain-words note.
4. **P5-3** `cc80aaa` — figure furniture: editable Figure title (override,
   cleared on each new chart request), Footnote drawn INSIDE the SVG on
   all 8 chart components (every export path carries it), copyable caption
   (`buildFigureCaption` in chartTitle.js), grayscale-safe toggle
   (`chartPalette(count, { grayscale })` forces the dark-to-light teal
   ramp for any count — threaded through bar/crosstab/smallMultiples/
   boxdot). NOTE: three older tests changed getByText→getAllByText because
   the caption legitimately restates the cohort sentence.
5. **P5-6** `d3d682f` — thousands separators (`fmtChartNumber`) on bar
   value labels, n (%) countLabel, histogram ticks, box-plot medians/axis.
   Rest of P5-6 was already true by construction (fonts inline via P5-1;
   slide text ≈20pt via P5-2 math) — verified, not rebuilt.
6. Owner guide `docs/prompting-guide.md` — new "Getting a chart out of the
   app" block (and the P6-5 small-multiples bullet from earlier).

All five were built failing-test-first and live-verified in the running
app (real clicks on Copy chart / Copy table, serialized SVG checked for
zero unresolved `var(--…)`, a real 2400px poster PNG rendered, grayscale
ramp + on-chart footnote screenshotted).

## What's NOT done — the remaining queue (spec order)

- **P5-4 — Office exports** (NEXT). Needs the two owner-approved MIT deps
  installed: `pptxgenjs` ("Send to PowerPoint": one 16:9 slide per chart —
  title, figure, n= footnote; "Export all results" deck) and `docx` (Word
  export; journal-style tables: three horizontal rules, n (%) / mean (SD)
  from clinicalFormat.js; this ALSO delivers the P4-5 committee report).
  Keep both lazy-loaded so the main bundle stays light. Everything runs
  client-side. The chart-to-PNG plumbing P5-4 needs already exists
  (`svgToPngBlob`, `computePresetExport` for slide sizing).
- **P5-5 — ggplot2 figure code** in the R script (extend rscripts/), same
  chart the preview draws (one brain), ending `ggsave(..., dpi = 300)`.
  Must cover ALL P6 types: position=stack/fill/dodge, geom_histogram,
  geom_boxplot + geom_jitter, Pareto, and facet_wrap for small multiples.
- **P4-3 — validation-list vocabularies** (largest unknown, deliberately
  last per the spec).
- The parked list (`.claude/prompts/parked-2026-07-17-brainstormed-queue.md`)
  — owner decides if anything there jumps the queue. **Ask, don't default.**

## Why this is a good stopping point

The zero-dependency export block is a complete unit: every chart type can
leave the app correctly sized, correctly colored, captioned, and
print-safe, with nothing half-built. P5-4 starts with `npm install` of two
new dependencies — exactly the kind of clean boundary a fresh session
should own end to end (install, lazy-load pattern, new UI, bundle check).

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main`.
2. `npx vitest run` — expect **1039 passing (161 files)**. If different,
   stop and diagnose (cloud-sync reversion; `git log` should show `d3d682f`).
3. No owner decision pending for P5-4 itself (deps approved 2026-07-11).
   The only open fork remains "spec order vs parked list" — spec order
   (P5-4) is the recorded default; ask only if picking a parked item.
4. Per-item workflow: failing test first (synthetic fixtures) → implement
   → full suite green → live-verify in the browser (`preview_start`,
   `.claude/launch.json` "TidyTable dev server") → commit named by ID.
   For P5-4 also verify the built bundle stays light (lazy import) —
   `npm run build` and check the chunk report.
5. Push/deploy only on the owner's explicit say-so — 42 local commits will
   be ahead of origin after the docs commit.
