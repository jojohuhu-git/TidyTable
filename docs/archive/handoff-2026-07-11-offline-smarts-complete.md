# TidyTable — offline-smarts plan COMPLETE (Phases 6–8 shipped, 2026-07-11)

**Repo:** `/Users/joannehuang/Downloads/TidyTable` · **Live:** https://jojohuhu-git.github.io/TidyTable/
**What TidyTable is:** a client-side, browser-only, plain-English spreadsheet-cleaning app
for a non-coder clinician. Core promise: **never guess, never silently drop or corrupt
data** — when unsure it asks; when it can't answer honestly offline it says so.

Branch: **`main`**, working tree **clean**, in sync with `origin/main` at commit
`7b2c77c` (pushed). **761 passing tests (126 files), all green.** All three GitHub Pages
deploys (Phase 6, 7, 8) **succeeded** — the site is live. Nothing is in flight; clean
stopping point.

## What this session did — the whole offline-smarts plan is now done
The plan at `.claude/prompts/plan-2026-07-10-offline-smarts.md` had Phases 6, 7, 8 left.
All three are now built, tested, merged (each as one `--no-ff` unit), and deployed. Each
phase was built by a subagent and independently verified (full suite + live app) before
merge.

- **Phase 6 — self-teaching test bank + AI graduation** (merge `7afcc97`, 641→661 tests).
  - `test/phrase-bank.json` + runner: templates expanded and run on the REAL engine —
    **185/193 (95.9%), 0 confident-wrong**. This is how "done" is measured (owner-agreed
    ≥90% answer-or-ask, 0 confident-wrong).
  - New `graduationStore.js`, `hitStore.js`, `planShape.js` (value-free plan shapes —
    column names only, never a cell value; `stripValues` is the enforced chokepoint).
  - **App.jsx wiring** (finished by the coordinator after the building agent was cut off
    by a session limit mid-file): the graduation store is loaded, passed into every
    `runOffline` call, and written to when Claude answers a Step-3 request — so an
    AI-answered question is answered OFFLINE next time with no API call. Proven by
    `src/phase6-graduation.dom.test.jsx`.
- **Phase 7 — Step 3 conversational & clinical extensions** (merge `03a6d93`, 661→728).
  All 9 items done, each its own commit + both test layers: cross-turn follow-ups, value
  typo-tolerance chips, number-words/unit conversion, compound "and" questions, **Table-1
  builder**, denominator+missing transparency, grain memory, show-the-rows-behind,
  teach-it form on decline. New modules `followUp.js`, `compound.js`, `table1.js`,
  `grainStore.js`, component `TeachItForm.jsx`. Phrase bank 242/250 (96.8%), 0 wrong.
  Live-verified: typo→"Did you mean amoxicillin?"→2 rows; "summarize diagnosis, drug and
  duration"→"Table 1: 3 characteristics" with n (%) / median (IQR) / mean (SD).
- **Phase 8 — Step 9 chart intelligence, "one brain, two steps"** (merge `7b2c77c`,
  728→761). `textToChart.js` now routes free text through the SAME Step 3 pipeline
  (`matchRequest`); chart-type inference is said out loud with one-click alternates;
  count bars carry **n (%)** labels; a **"Chart this"** chip on chartable Step 3 answers
  seeds Step 9; plain-word post-draw tweaks ("only top 5", "sort alphabetically"); new
  chart-flavored phrase bank `test/chart-phrase-bank.json` (**55/55, 0 wrong**). All 69
  pre-existing chart tests still pass. Live-verified end-to-end: "How many rows by
  Diagnosis?" → Chart this → 3-bar "count by Diagnosis" chart, "2 (33%)" labels, spoken
  "Bar chart because Diagnosis is categories…".

## What's NOT done — deferred sub-items (each a real standalone unit, not a loose end)
The building agents deferred these honestly because each is larger than a safe single
commit. None block anything; pick up when the owner wants them:
- **New chart TYPES + their markers (from Phase 8.2/8.3):** histogram, box plot, and
  100%-stacked bar — each needs a new SVG renderer + Excel-steps. The median/IQR
  distribution markers depend on the box-plot renderer.
- **Live "flip the axes"** tweak — recognized today but answered honestly rather than
  transformed (needs advisor-layout plumbing).
- **Chart-side save-on-success + AI graduation loop (Phase 8.6):** the measurable chart
  phrase bank landed; wiring the chart path into `hitStore`/`graduationStore` the way
  Step 3 is wired is a separate integration.
- **Owner-deferred from the plan (not now):** date/time questions ("by month", "over
  time" — Visit_date is text-typed in the example file) and missing/blank-value questions
  ("how many are missing a lab value"). The plan flags blank-value as a good next pick.

## Resuming
1. `cd /Users/joannehuang/Downloads/TidyTable && git checkout main && git pull`
2. `npx vitest run` — confirm **761 passing** before any new work.
3. Start the dev server (owner's standing rule): `preview_start` name
   **"TidyTable dev server"**, port 5175, config `.claude/launch.json`.
4. Per-item workflow: reproduce → failing test (synthetic fixture, never real patient
   data) → confirm it fails → fix minimally → **full suite green** → live-verify if
   UI-observable → commit named for the item. **Both layers** (node logic + happy-dom
   DOM) for any visible behavior.
5. Ship (TidyTable): `main` is NOT branch-protected; a push to `main` **auto-deploys** to
   GitHub Pages. This session used branch → `--no-ff` merge → push per phase; keep that so
   each unit is reviewable.
6. Honesty invariants that must never regress (all test-enforced, incl. two phrase banks):
   never a silent guess; the refinement pool only ever shrinks; nothing in localStorage
   holds a cell value (column names / plan shapes only); an unresolvable chart request
   asks or declines, never draws a plausible-wrong chart.

## Note for the next session
One harmless artifact seen during this session: editing `App.jsx` under a running dev
server produced Vite HMR state-mismatch errors in the browser console (URLs tagged
`?t=<timestamp>`). They are NOT in the committed code — a fresh page load renders and
runs cleanly (root stays mounted, full flow works). If you see App-component errors in
the console, hard-reload before treating them as real.
