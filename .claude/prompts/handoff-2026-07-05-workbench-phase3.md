# Handoff — TidyTable Clinical Workbench, resume at Phase 3

**Date:** 2026-07-05
**Model:** Use Opus 4.8 for Phase 3 (the matcher/cohort engine is hard to change later). Sonnet 5 is fine for Phase 4–5 template/content authoring.
**Repo:** `~/Downloads/TidyTable` (cloud-synced — reversion gotcha; commit often).

## How to resume

1. Read `.claude/prompts/build-clinical-workbench.md` (master spec, source of truth).
2. Read this handoff, then the Phase-0/1 handoff `handoff-2026-07-05-workbench-phase2.md` for earlier context.
3. `git checkout phase/2-recipes` (all Phase 0–2 work is stacked on this branch), `npm install`, `npm test` (should be **57 passing**), `npm run dev` (port 5175).
4. Start Phase 3. Cut `phase/3-matcher` off `phase/2-recipes`, or continue on it — either is fine. **Stay local — no push.** Owner reviews before anything hits GitHub.

## Decisions locked (do not re-litigate)

- Branch per phase off the running stack; stay local.
- Master spec §3 still holds: record-and-replay not infer-by-example; refuse-don't-guess on clinical vocab; offline-first; privacy mode; slot-filling not free grammar; no icons/emoji/serif; classic-Excel-primary.

## Phase 2 — DONE (commit a7d2ed0, on branch phase/2-recipes)

All in `src/logic/recipes/` + three components. Scenario 2 passes at the logic level and the report-card render is covered by the first component test.

- **`recipe.js`** — recipe = `{ version, name, createdAt, steps[] }`. Steps reference columns **by header name**; `matchColumn()` / `columnKey()` do case/space/punctuation-insensitive fuzzy matching (a true rename does not match → becomes a replay surprise). Step kinds: `checkupFix` (wraps the exact `{normalizer,column,params}` fix shape buildFixPlan takes), `deidentify` (`{column}`), `reportCards` (`{personColumn, valueColumn, groupColumn}`, terminal). Serialize to JSON; localStorage library (`listRecipes/saveRecipe/deleteRecipe`) + file `parseRecipe`.
- **`keyStore.js`** — `{ version, prefix, next, codes: {name->code} }`. `assignCodes` / `applyCodesToColumn` are pure (don't mutate input), assign the next padded code (`Prescriber 07`) to new names, keep known ones stable. Stored SEPARATELY in localStorage (`tidytable_key_store`), file round-trip via `serializeKeyStore/parseKeyStore`.
- **`replay.js`** — `replayRecipe(recipe, sheet, keyStore)` → `{ rows, keyStore, steps, surprises, newPeople, reportCards, logEntries }`. Applies **recorded** rules only (uses the checkup normalizers directly, not the worker). Surprise types: `missingColumn` (renamed/removed), `newCategoryVariant` (spellings that fold together but no recorded rule merges — left as-is, not guessed), `newPeople`, `smallCell`, `unknownStep`. `formatReplayReport()` renders the plain-English report.
- **`reportCards.js`** — `buildReportCards(rows, {personColumn, valueColumn, groupColumn})`. **Privacy invariant: never given the key** — operates only on the already-coded table, so output cannot hold a name (asserted in tests). Subject bar accent, peers gray; small-cell warning for any displayed group of ≤2.
- **UI:** `RecipePanel.jsx` (step 5 — records checkup fixes automatically, lets user add the deidentify + report-card steps, name/save/export), `ReplayPanel.jsx` (step 6 — own file picker + recipe picker/import, runs replay, shows report + surprises + report cards + downloads for cleaned data / replay report / cleaning log / code list), `ReportCardsView.jsx`. `App.jsx` records applied fixes into `recipe` state and holds a `keyStore` state (loaded from localStorage, persisted on replay).

### Key design reconciliation (was ambiguous in the spec)
§7 says report cards show "own row(s) by name". Scenario 2 flatly requires **no real name in report output** and the key must be structurally unable to appear. These conflict, so report cards are **code-only**: the subject is shown by their code, highlighted among gray peer codes. The subject knows their own code via the private key list, which is never shared. This is the resolved behavior; tests enforce name-free output.

### Notes / discrepancies
- `deriveSheet` infers a CSV/xlsx column as `date` when values match `^\d{4}-\d{2}-\d{2}`; report-card `valueColumn` menu only offers `type === "number"` columns. Fine for now.
- Cleaning log (`cleaningLog.js`) is reused unchanged; replay produces `logEntries` in the same shape and offers a downloadable log. It is not yet auto-merged into App's `sessionLog` (replay is a separate flow with its own file) — a clean later add if the owner wants one cumulative log across the describe flow and replay.
- Report-card `valueColumn` totals a numeric column; default is per-person row count.

### Verification done
57 tests pass; production build clean; no emoji/serif in new code. Browser: the two new components are rendered through the real React path in `recipes.dom.test.jsx` (subject-bar accent class, small-cell warning, no-name-leak, step recording via real select/click). A full manual browser click-through was **not** done because port 5175 was held by another session's dev server — worth a quick manual pass when convenient (upload a messy file → apply fixes → add deidentify + report cards → save → replay on a second file).

## Next: Phase 3 — Matcher & cohort questions (master spec §8, scenarios 3, 4, 7)

Build in `src/logic/offline/`: `entries/`, `synonyms.js`, `matcher.js`, `fillPlan.js`, `missLog.js`. Three confidence states (Confident/Unsure/No-match) with the `looked_for` trust panel; slot filling (fuzzy columns, value scan, comparators, proportion); **grain detection**; Definitions-sheet clinical-knowledge gate (refuse, don't guess); nested "of those" chains; chained-steps mode; miss logging; Claude fallback hint using only the privacy-mode synthetic context. Wire `PromptPanel`/`handleRun` to try the offline engine before the API. Acceptance = scenarios 3, 4, 7. Build both logic and component tests. Then Phase 4 (stats + R), Phase 5 (charts + recipe-shelf completion).

## Testing / house rules (unchanged)

- Vitest: `npm test`. Logic tests node env; component tests add `// @vitest-environment happy-dom` (or `*.dom.test.jsx`). `@testing-library/react` is available.
- All user-visible text: plain, jargon-free, sentence case, no exclamation marks. Grep build for emoji + serif before calling a phase done (scenario 8).
- Keep checkup normalizer cell functions closure-free (they get `.toString()`-inlined into the worker).
- Preview server: `preview_start` name "TidyTable dev server", port 5175, config `.claude/launch.json`.
