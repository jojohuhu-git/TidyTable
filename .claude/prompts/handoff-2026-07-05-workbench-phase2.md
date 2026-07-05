# Handoff — TidyTable Clinical Workbench, resume at Phase 2

**Date:** 2026-07-05
**Model:** Use Opus 4.8 for Phases 2–3 (recipes/replay/matcher are hard to change later); Sonnet 5 is fine for Phase 4–5 template/content authoring.
**Repo:** `~/Downloads/TidyTable` (cloud-synced folder — reversion gotcha; commit often).

## What this is

Building the TidyTable clinical data workbench per the master spec at
`.claude/prompts/build-clinical-workbench.md` (Phases 0–5, 8 acceptance scenarios).
**Read that spec fully first — it is the source of truth.** This handoff only records
current state and the deltas/decisions discovered during Phases 0–1.

## How to resume

1. Read `.claude/prompts/build-clinical-workbench.md` (master spec).
2. Read this handoff.
3. `git checkout phase/0-ux-rails` (all work so far is on this branch), `npm install`, `npm run dev` (port 5175), `npm test` (should be 40 passing).
4. Start Phase 2. Branch strategy below.

## Decisions locked with the owner (do not re-litigate)

- **Branch per phase off `main`; STAY LOCAL — no push.** Owner reviews before anything hits GitHub. (So far both phases sit on one branch `phase/0-ux-rails`; you may keep going on it or cut `phase/2-recipes` off it — either is fine, just stay local.)
- Everything else in the master spec §3 still holds (record-and-replay not infer-by-example; refuse-don't-guess on clinical vocab; offline-first; privacy mode; slot-filling not free grammar; no icons/emoji/serif; classic-Excel-primary).

## Discrepancies found vs the master spec (already handled — be aware)

1. **§1 is describing the OLD feature branch, not `main`.** On the `main`-based branch, these did NOT exist at the start: `ClarifyBox`, `ChartsPanel`, `FormulaPrimer`, `chartPreview.js`, and there was **no test runner** (spec claims happy-dom was a devDep — it was not). We branched off `main` for a clean base. `ClarifyBox` has now been created (Phase 1). `ChartsPanel`/`chartPreview` still do not exist — Phase 5 will create them. If you want the old feature-branch implementations for reference, they are on branch `feature/novice-audit-charts-eval`.
2. **CSV import coerces text-numbers.** SheetJS turns `"$1,200"` into the number `1200` on CSV load, so the text-numbers checkup can't be demoed via a CSV drop in the browser — it's covered by unit tests on in-memory strings. Real `.xlsx` files with text-formatted cells still trigger it. Not a bug.

## Phase 0 — DONE (commit 7d51ebb)

- Vitest stood up: `vitest.config.js` (node env for logic; `*.dom.test.jsx` → happy-dom; `globals: true` for auto DOM cleanup), `test/setup.js`, `npm test` / `npm run test:watch`.
- UX §4: serif masthead → body sans; all emoji removed (`✓`/`📍`/`🔒` → words); circular step badges → worded "Step N —" labels; per-section intros + results empty state; sentence-case, no exclamations.
- Privacy §5: `src/logic/synthetic.js` makes shape/format-preserving fake values from a **seeded stream (not the input)**; `buildDataContext` sample mode now sends headers/letters/types + made-up examples ONLY (test asserts real values never appear); full mode still real, labeled; permanent "Your data has not left this computer." badge; `ResultsPanel` labels `engine:"offline"` plans.
- No hard API-key gate: Step 3 (describe) is usable without a key; run gates on prompt presence; missing key is a plain note. Until the offline matcher lands (Phase 3), running still routes through the AI and says so.

## Phase 1 — DONE (commit d4598d0)

Checkup engine in `src/logic/checkup/`:
- `normalizers.js` — 6 pure self-contained cell functions (`coerceNumbers`, `sentinelBlanks`, `parseDates`, `trimCase`, `censoredValues`, `splitList`) + `EXCEL_STEPS` helper-column recipes + `NORMALIZERS` registry. Cell fns are inlined into the worker transform via `Function.toString()` so browser/worker agree — **keep them closure-free and ES5-ish**.
- `scan.js` — `checkupSheet(sheet)` returns findings for all 8 types + mixed-units (flag-only). Category merge folds case/space only; it does NOT guess abbreviations (`M` is left, `male`→`Male` merged). Each finding: `{id,type,sheet,column,letter,title,detail,count,samples,fixable,fix}`.
- `buildFixPlan.js` — `buildFixPlan(sheet, fixes)` → `{plan, log, cleanedRows}`. `plan` is PLAN_SCHEMA-shaped + `engine:"offline"`. Order: value fixes → dedupe → row-split. Log computed from the same pure fns.
- `cleaningLog.js` — `makeLogEvent`, `formatCleaningLog`. Cumulative, before/after counts, exportable.

UI: `ClarifyBox.jsx` (reusable one-question; censored fix gates on it), `CheckupPanel.jsx` (checklist; nothing applied until ticked; every finding dismissable). App wires a new **Step 2 checkup** before describe; applying replaces the sheet with cleaned rows (`workbook.deriveSheet`) so later steps use them, and shows a downloadable cleaning-log card.

**Scope limit:** checkup runs on the **first sheet only** for now (labeled when a workbook has >1 sheet). Multi-sheet is a clean later add.

## State shape (App.jsx) as of now

`apiKey, model, workbook, excluded, privacyMode, prompt, busy, status, error, plan, resultRows, sessionLog, checkupVersion`.
`workbook = { fileName, sheets:[{name, headers:[{letter,name,type,samples}], rows, rowCount}] }`.
`handleApplyFixes(fixes)` builds the offline plan, runs it, updates workbook + sessionLog, bumps `checkupVersion` (which re-keys `CheckupPanel` so it rescans cleaned data).

## Next: Phase 2 — Recipes, replay, report cards (master spec §7, scenario 2)

Build in `src/logic/recipes/`:
- **Recording:** every applied action (checkup fix already emits a plan+log — hook it in; later: cohort question marked "include in monthly report", deidentification, chart) appends a step to the current recipe. Steps reference columns **by header name** (fuzzy-matched on replay: case/space/punctuation-insensitive), never by position. Recipes serialize to JSON: localStorage + file export/import.
- **Replay:** upload next month's file → pick a recipe → run → end with a plain-language report: steps applied with row counts at each step, and **surprises loudly** (new category values no rule covers, a column that no longer fuzzy-matches, new people, rows a rule couldn't handle). Never silently guess or drop.
- **Cleaning log** already exists (Phase 1) — extend it to accumulate across replay; every module writes to it.
- **Deidentification key file:** local-only `name → stable code` map, stored SEPARATELY from recipes/reports, export/import like recipes. New people get the next unused code on replay; report says so. **The key must be physically incapable of appearing in report output** — the report generator takes the already-coded table, never the key.
- **Report cards:** a recipe's terminal step; one section per person, own row(s) by name, peers as codes; own bar accent, peer bars gray (this is also the chart default in §11). Small-cell warning: any displayed group of 1–2 people flagged as re-identifiable.

Acceptance = scenario 2 (record on month-1 fixture → replay on month-2 with 2 new prescribers, 1 new spelling variant, a renamed column → replay report announces all three; new prescribers get new stable codes; no real name in report output; a size-1 group triggers the small-cell warning). Build both a logic test and a component test.

Then Phase 3 (matcher/cohort questions — the other Opus-hard phase), Phase 4 (stats + R), Phase 5 (charts + recipe-shelf completion). See master spec §14.

## Testing / house rules

- Vitest: `npm test`. Logic tests node env; component tests add `// @vitest-environment happy-dom` at top (or `*.dom.test.jsx`).
- All user-visible text: plain, jargon-free (no "string/array/parse/null/schema/JSON/regex/…" — Excel/R function names are fine), sentence case, no exclamation marks. Grep the build for emoji + serif faces before calling a phase done (scenario 8).
- Keep normalizer cell functions closure-free (they get `.toString()`-inlined into the worker).
- Preview server: `preview_start` name "TidyTable dev server", port 5175, config `.claude/launch.json`.
