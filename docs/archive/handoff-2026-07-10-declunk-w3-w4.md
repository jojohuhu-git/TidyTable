# Handoff — TidyTable de-clunk: W3 + W4 remaining (2026-07-10)

## For the next conversation / agent

You are continuing the **TidyTable de-clunk revision**. Two of four workstreams are DONE (on
local branches, unpushed). Your job is **W3 then W4**. Read the full plan first:
`~/Downloads/TidyTable/.claude/prompts/revise-2026-07-10-declunk-ux.md` — it has the goals, the
owner's locked decisions (do NOT re-ask them), the exact files to touch per workstream, and the
required tests.

TidyTable is a browser-only React + Vite app that cleans/analyzes messy Excel files for
spreadsheet/RStudio **novices** (clinical data). Owner: Joanne (jojohuhu-git) — explain everything
in plain, jargon-free language.

## What's already done (do not redo)

| Workstream | Branch | Tests | Status |
|---|---|---|---|
| Baseline | `main` (post-PR-#1) | 384 | live 10-step app |
| **W1** Step-2 "Download your fixed file" | `revise/w1-download-fixed-file` | 390 | DONE, local only |
| **W2** smarter offline matcher + examples | `revise/w2-smarter-matcher` | 415 | DONE, local only |

Both branches are **committed locally, NOT pushed and NOT merged.** All tests green (verified by
running `npx vitest run` on each branch, not just trusting the agent).

- W1 added `downloadWorkbookAsXlsx` to `src/logic/workbook.js`, a primary download button in Step 2
  (`App.jsx`), copy line, `styles.css`, plus logic + DOM tests.
- W2 added token/prefix fuzzy value matching (`src/logic/offline/valueMatch.js`, `matcher.js`),
  ~15 clinical abbreviation seeds (`synonyms.js`, editable via the Definitions editor), "in urine"
  column scoping, middle-path "Did you mean…?" confirmation (`ClarifyBox.jsx`, `App.jsx`), helpful
  declines with nearest-match chips, and file-derived example prompts + cheat-sheet
  (`examplePrompts.js`, `PromptPanel.jsx`). Canonical "E. Coli in urine → ESCHERICHIA COLI /
  Urine Organisms" regression test lives in `src/logic/offline/w2-smarter-matcher.test.js`.

## Remaining work

### W3 — Steps 4/5: running results list + one-click "Save this routine" (size M)
Plan §W3. Files: `App.jsx`, `ResultsPanel.jsx`, `RecipePanel.jsx`,
`src/logic/recipes/recipe.js`, `replay.js`.
- Step 4 becomes **"Your results so far"**: an accumulating array of result cards (question or
  checkup-apply, one-line answer + timestamp), newest first, each expandable to the full existing
  `ResultsPanel` (result / Excel steps / R script tabs + downloads), with a per-card remove button.
  Persist per-session (mirror how B5 stores the in-progress recipe in localStorage).
- **Auto-record questions into the routine**: a successful Step 3 answer appends a `question` step
  (store original wording + resolved plan), same mechanism checkup fixes already use. Each card:
  "Saved to your routine ✓ (remove)".
- Step 5 → **"Save this routine"**: rename all UI copy from "recipe" to "routine" (internal
  identifiers may stay `recipe` to limit churn — UI copy + file-extension label only). Show recorded
  steps, a name box pre-filled like "DC antibiotics — monthly", and ONE primary button
  "Save this routine". Fold de-identify + report-cards pickers into a collapsed `<details>`
  "Optional extras".
- Step 6 copy → "Run a saved routine on next month's file". Replay must execute `question` steps:
  re-resolve the stored plan against the new file; if a column/value no longer exists, say so
  plainly in the replay report (house rule: say it, don't guess).
- Tests: results accumulate + expand (DOM); question step recorded and replayed on a second fixture
  with one renamed column → plain report line (logic + DOM).

### W4 — Step 9: describe the chart in words; the app designs it (size M–L, do after W3)
Plan §W4. Files: `src/components/ChartsPanel.jsx`, `ChartPreview.jsx`,
`src/logic/charts/advisor.js`, `aggregate.js`, `excelChart.js`; **reuse the W2 matcher pieces**
(that's why W4 comes last).
- Free-text box at top of Step 9 ("Describe the chart — e.g. 'organisms in urine by number of
  patients'"). Parse via the W2 matcher (intent → count/sum/average; value + column scope → filter;
  group-words → label column). Same middle-path confirmation for stretches. Keep the two dropdowns
  below as "…or pick by hand", reflecting what the text resolved to.
- Advisor layout intelligence: many categories (>~12) → **horizontal** bar chart, sorted
  largest-first, SVG height grows with row count — draw ALL data (owner decision: never refuse for
  "too many values"). Offer (never force) a reversible "group values under X% into 'Other'".
  Time labels → line; two numerics → scatter; ≤4 parts of whole → pie offered (all existing).
- Palettes: new `src/logic/charts/palette.js` with the Okabe-Ito colorblind-safe palette for ≤8
  series; single-hue ramp with top 3 emphasized for long horizontal lists. Plain hex arrays, **no
  new dependencies**.
- Extend `excelChartSteps` to cover horizontal bars (Excel "Bar" vs "Column"), the sort step, the
  helper aggregation table (exact columns/rows), and a note on applying the same colors — steps must
  reproduce the preview exactly.
- Tests: text→chart resolution table (logic); 40-category fixture renders horizontal all-rows SVG
  with readable labels (DOM); palette unit tests; Excel steps mention Bar + sort for the long case.

## Hard constraints (unchanged, non-negotiable)
- **Branch per workstream off `main`**: `revise/w3-results-routine`, then `revise/w4-freetext-charts`.
- **NEVER push, NEVER merge, NEVER spawn sub-agents to do the work — do it yourself.** Local
  branches only; owner reviews before anything goes up. (The first W1/W2 agent hallucinated a
  hand-off and did nothing — verify your own work on disk.)
- **No new dependencies.** Plain-English UI copy. Never guess silently, never drop data quietly.
  In-app result, Excel recipe steps, and R script must produce identical numbers.
- Both test layers for anything visible: logic (node) + DOM (happy-dom). Keep the suite green
  (run `npx vitest run`; W2 baseline is 415 — but W3/W4 branch off `main` = 384, unless you rebase).
- Folder is cloud-synced (reversion gotcha) — commit often.

## Owner's locked decisions (do NOT re-ask — from the plan)
- Step-3 confirmation = middle path (instant on exact match; "Did you mean…?" only on stretches).
- The word is **"routine"**, not "recipe", in all UI copy.
- Charts draw ALL requested data by default; grouping into "Other" is offered, never forced; the
  owner should never have to be prescriptive about chart design.

## First moves for the next session
1. `cd ~/Downloads/TidyTable && git checkout main && npx vitest run` (confirm 384 baseline).
2. Read the plan file §W3 and §W4, and the real source files named above before changing anything.
3. `git checkout -b revise/w3-results-routine` and implement W3 end to end; commit; then W4 off
   `main`. Report back with branch names, files changed, test counts, plain-English user-visible
   changes, and anything you couldn't do cleanly.
