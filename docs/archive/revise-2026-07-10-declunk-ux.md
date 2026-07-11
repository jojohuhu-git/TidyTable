# TidyTable — De-clunk revision plan (2026-07-10)

> **Status: PLANNED, not started.** Written with the owner on 2026-07-09/10. Nothing here is
> implemented. Do not commit this file's changes without the owner's go-ahead per workstream.

You are working on **TidyTable**, a browser-only React + Vite app that cleans and analyzes messy
Excel files for spreadsheet/RStudio **novices** (often clinical data). Local repo:
`~/Downloads/TidyTable`. Live: https://jojohuhu-git.github.io/TidyTable/. Owner: Joanne
(jojohuhu-git) — explain everything in plain, jargon-free language.

## Base branch and ground rules

- **Base off `main`.** The 2026-07-09 fix queue (phases 0–5 + all audit fixes, 384 tests) was
  merged via PR #1 — `main` IS the current 10-step app. The old handoffs that say "branch
  `fix/2026-07-09-audit-findings`, not pushed" are historical; do not resume them.
- Branch per workstream (e.g. `revise/w1-download-fixed-file`), commit often (folder is
  cloud-synced — reversion gotcha), **never push or merge without the owner's review**.
- House rules: never guess silently, never drop data quietly; in-app result, Excel recipe steps,
  and R script must produce identical numbers. Plain-English UI copy. **No new dependencies.**
- Tests: `npx vitest run` (baseline ~384 green — confirm actual count first). Every change needs
  both layers: a logic test (node) and a DOM test (happy-dom) for anything visible.

## The owner's complaints, verbatim in spirit

1. **Step 2**: "when I click to apply selected fixes, I want it to add the fixes to the excel
   sheet that I can redownload." (Today the cleaned rows only appear far away in Step 4 as
   `TidyTable_result.xlsx`, one sheet, generic name.)
2. **Step 3**: "it is looking for too specific language and defers to needing AI too often."
   Real failure: on the DC-antibiotics test file, "number of patients with E. Coli in urine"
   could not find `ESCHERICHIA COLI` under a urine-organisms column, even after adding a
   definition. Owner also wants **example prompts** that work offline.
3. **Steps 4/5**: results should accumulate into a **running list** that doubles as the map of a
   reusable routine; saving should be one click; "Save monthly recipe" renamed.
4. **Step 9**: describe the chart in **free text**; the app chooses the design (owner: "I should
   not have to be prescriptive"); large category counts must still produce a chart; colors should
   be aesthetically matched but distinct.

## Owner decisions already made (do not re-ask)

- **Step 3 confirmation style — middle path**: answer immediately when the match is exact and
  unambiguous; show a "Did you mean …?" confirm **only** when the app stretched (abbreviation
  expansion, partial value match, or multiple candidate columns/values).
- **Step 5 rename**: the feature is called a **routine** — "Save this routine", "Run a saved
  routine on next month's file".
- **Step 2 download**: a plain-formatting `.xlsx` copy of the **whole workbook** is fine (cell
  colors/widths lost, data intact) — as long as it is a real Excel file.
- **Step 9**: never refuse for "too many values". Default to drawing **all** requested data
  (horizontal bars, sorted largest-first, chart grows taller as needed); offer — never force —
  grouping small values into "Other".

---

## W1 — Step 2: "Download your fixed file" (small, do first)

**Goal:** after applying checkup fixes, one obvious primary button in Step 2 downloads the whole
workbook with fixes applied.

- Add `downloadWorkbookAsXlsx(workbook, fileName)` to `src/logic/workbook.js` — writes **all**
  sheets (cleaned first sheet + untouched others) via the existing `xlsx` lib.
- In `App.jsx` / `CheckupPanel.jsx`: once at least one fix has been applied this session, render
  a primary button **inside the Step 2 card**: "Download your fixed file (.xlsx)". Filename:
  original name + ` (cleaned).xlsx` (e.g. `DC antibiotics (cleaned).xlsx`).
- One line of copy under it: "Same file, fixes applied. Cell colors and column widths are reset —
  the data itself is untouched."
- Keep the Step 4 result downloads as they are.
- Tests: logic — exported workbook has every sheet and the cleaned rows in sheet 1; DOM — button
  absent before apply, present after, correct filename.

## W2 — Step 3: smarter offline matcher + example prompts (the big one)

**Goal:** "number of patients with E. Coli in urine" answers offline. The app should reach for AI
rarely, and when it declines it should show its nearest guesses instead of just saying "add a
definition / use AI".

Files: `src/logic/offline/matcher.js`, `synonyms.js`, `definitions.js` (+ B7's
`definitionsStore.js`), `runOffline.js`, `src/components/PromptPanel.jsx`, `ClarifyBox.jsx`.

### W2a — Partial / fuzzy value matching
Today `resolveCondition`'s value scan requires an exact folded match of the whole phrase or a
single word. Add a **token-subset tier**: fold the query phrase and each cell value into word
tokens; match when every query token equals **or is a prefix of** some value token (so
`e coli` → `ESCHERICHIA COLI`: "e"→prefix of "escherichia", "coli"→"coli"). Score candidates
(exact > all-tokens-equal > prefix), collect ties across columns.
- Exactly one strong candidate → proceed, flag `stretched: true`.
- Several candidates → clarify (see W2d).

### W2b — Clinical abbreviation seeds
Add a small built-in synonym table (in `synonyms.js` or seeded into B7's definitions store, whose
entries the user can see/edit/delete in the in-app Definitions editor): E. coli / e coli →
escherichia coli; MRSA, MSSA, VRE, ESBL, GBS → their long forms; staph → staphylococcus;
strep → streptococcus; klebs → klebsiella; pseudomonas/psa; c diff → clostridioides difficile;
UTI-style terms only if they map to values, not concepts. Keep it short (~15 entries), visible,
and editable — the Definitions editor remains the extension point. Expansion always counts as a
**stretch** (confirm before answering).

### W2c — Column scoping ("in urine")
Recognize `in|under|from|within <phrase>` (and "<phrase> column") as a **column hint**: fuzzy-match
the phrase against headers with the existing `fuzzyColumn` plus a token-subset tier (so "urine"
hits "Urine Organisms"). When a hint resolves, restrict the value scan to that column first; only
fall back to all columns if nothing matches there (and say so). If the hint phrase matches a value
instead of a header, treat it as a value (current behavior) — never double-count.

### W2d — Middle-path confirmation (owner's decision)
Reuse the `ClarifyBox` pattern (`pendingGrain` in `App.jsx`):
- Exact, single-candidate resolutions → answer immediately; the existing `lookedFor` summary
  states exactly what was matched.
- Any stretch (abbreviation, prefix/token-subset match, ambiguous column/value) → show
  "Did you mean **ESCHERICHIA COLI** in **Urine Organisms**?" with the top 2–3 candidates as
  buttons + "Something else". One click runs it; remember the confirmed mapping for the rest of
  the session (session-level alias map) so the same question never asks twice.

### W2e — Helpful declines (stop deferring to AI)
When nothing resolves, replace the current notice with: the term it couldn't place, the **3
nearest values/columns it can see** (by token overlap) as clickable chips, then "add a definition"
and only last "or send to Claude (uses your key)". The AI is the last resort in copy and in order.

### W2f — Example prompts, generated from the user's own file
Under the Step 3 textarea, show 4–6 clickable examples built from the actual headers/values of the
uploaded sheet, one per supported pattern, e.g.:
- "How many patients have ESCHERICHIA COLI in Urine Organisms?" (count + value + column scope)
- "Average Duration_days by Ward" (average + group-by)
- "How many patients with Age over 65?" (threshold)
- "What percent of patients received Ceftriaxone?" (proportion)
- "Of patients with ESCHERICHIA COLI, how many stayed over 7 days?" (nested)
Clicking fills the box (doesn't run). Add a collapsible "What kinds of questions work without AI"
cheat-sheet listing the five intents in plain words. Pick example values from high-frequency cells
so the examples always return non-trivial answers.

Tests: matcher logic table-driven cases (E. coli/urine included as the canonical regression),
clarify-flow DOM test, examples-render DOM test. Re-run the eval harness idea from
`feature/novice-audit-charts-eval` (`run-evals.mjs`) if easy to port — optional.

## W3 — Steps 4/5: running results list + one-click "Save this routine"

**Goal:** every result accumulates into a visible list; that list IS the routine; saving is one
click; the word "recipe" disappears from the UI.

Files: `App.jsx`, `ResultsPanel.jsx`, `RecipePanel.jsx`, `src/logic/recipes/recipe.js`,
`replay.js`.

- **Step 4 → "Your results so far"**: keep an array of result entries (question or checkup-apply,
  one-line answer such as "14 patients", timestamp). Render as a list of cards, newest first; each
  expands to the full current `ResultsPanel` (result / Excel steps / R script tabs + downloads).
  Remove button per card. Persist per-session only (localStorage already holds the in-progress
  recipe via B5 — mirror that).
- **Auto-record questions into the routine**: successful Step 3 answers append a `question` step
  to the recipe/routine (store the original wording + the resolved plan), same as checkup fixes
  already do. Each card shows "Saved to your routine ✓ (remove)".
- **Step 5 → "Save this routine"**: header and all copy renamed (routine, not recipe; internal
  identifiers can stay `recipe` to limit churn — UI copy only, plus file extension label). Panel
  shows the recorded steps list (cleanups + questions + optional extras), a name box pre-filled
  like "DC antibiotics — monthly", and **one primary button: "Save this routine"**. Fold the
  de-identify and report-cards pickers into a collapsed `<details>` "Optional extras".
- **Step 6 copy**: "Run a saved routine on next month's file". Replay must execute `question`
  steps: re-resolve the stored plan against the new file; if a column/value no longer exists,
  report it plainly in the replay report (house rule: say it, don't guess).
- Tests: results accumulate + expand (DOM); question step recorded and replayed on a second
  fixture file with one renamed column → plain report line (logic + DOM).

## W4 — Step 9: describe the chart in words; the app designs it

**Goal:** free-text chart requests; the app picks type, layout, sort, and colors; huge category
counts still chart.

Files: `src/components/ChartsPanel.jsx`, `ChartPreview.jsx`, `src/logic/charts/advisor.js`,
`aggregate.js`, `excelChart.js`; reuse matcher pieces from W2.

- **Free-text first**: a text box at the top of Step 9 ("Describe the chart — e.g. 'organisms in
  urine by number of patients'"). Parse with the W2 matcher (intent → count/sum/average; value +
  column scope → filter; group-words → label column). Same middle-path confirmation for
  stretches. The two dropdowns stay below as "…or pick by hand" and reflect what the text
  resolved to, so the user learns the mapping.
- **Layout intelligence in the advisor**: many categories (> ~12) → **horizontal** bar chart,
  sorted largest-first, SVG height grows with row count — all data drawn, per the owner's
  decision. Offer a one-click, reversible "group values under X% into 'Other'" suggestion.
  Time labels → line (existing); two numerics → scatter (existing); ≤4 parts of a whole → pie
  offered (existing).
- **Palettes**: hardcode the Okabe-Ito colorblind-safe palette for ≤8 distinct series; for long
  horizontal bar lists use a single-hue ramp with the top 3 emphasized in a stronger shade —
  "matching but distinct". No new dependencies; plain hex arrays in a new `palette.js`.
- **Excel rebuild steps**: extend `excelChartSteps` to cover horizontal bars (Excel "Bar" vs
  "Column"), the sort step, the helper aggregation table (exact columns/rows to select), and a
  one-line note on applying the same colors. The steps must reproduce the preview exactly.
- Tests: text→chart resolution table (logic); 40-category fixture renders horizontal all-rows
  SVG with readable labels (DOM); palette function unit tests; Excel steps mention Bar +
  sort for the long case.

## Suggested order and sizing

| Order | Workstream | Size | Why this order |
|---|---|---|---|
| 1 | W1 download fixed file | S | Quick win, zero risk, immediate relief |
| 2 | W2 matcher + examples | L | The core "clunky / defers to AI" complaint |
| 3 | W3 results list + routine | M | Depends on nothing; renames + auto-record |
| 4 | W4 free-text charts | M–L | Reuses W2's parser — do after W2 |

Each workstream is independently shippable. Owner reviews each before anything is pushed.
