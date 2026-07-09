# TidyTable — Handoff after the 2026-07-09 P0/A1/A2 pass

Branch: `fix/2026-07-09-audit-findings`, off `phase/5-charts`. **Not pushed** — 7 commits,
all local, owner reviews before anything hits GitHub. Baseline was 141 passing tests;
now 194 passing (25 files), all green.

## What's done (by finding id) — see commit log for full detail on each

1. **P0-1 + NEW-1** (`78791d8`) — `parseDates` now validates month/day/calendar before
   rewriting (rejects `25/03/2024` as MDY, rejects Feb 30, etc.); date order (M/D/Y vs D/M/Y)
   is decided per column, asking the user via a generalized `ClarifyBox`/`needsPolicy` flow
   when genuinely ambiguous. Values that don't form a valid date are left unchanged and
   counted as "could not be read." Recorded order flows through `fix.params.order` to
   `buildFixPlan`'s transform, Excel step text, and `replay.js` — nothing re-guesses.
   New `epochSerialToNumber` normalizer + `findEpochDates` checkup finding recovers real
   `.xlsx` columns where Excel auto-formatted a numeric duration as a date near its
   1899-12-30 epoch (verified empirically with a real SheetJS round-trip — see the probe
   script pattern in the commit if you need to re-derive the epoch math).
2. **P0-2 + NEW-2** (`11be239`) — `toNumber` in the offline cohort engine returns `null`
   (not 0) for non-numeric text, censored markers (`<5`), and ranges (`12-14`); strips a
   trailing unit suffix (`"5 Days"` → `5`) before the numeric check so legitimate
   unit-suffixed durations aren't dropped by the stricter check. `executeCohort` now
   reports `skippedCount`/`skippedColumn` per threshold stage; `fillPlan`'s summary states
   it in plain English. The worker's `transform_code` inlines the real `toNumber` via
   `.toString()` instead of a hand-duplicated copy that could drift. Also added a
   `stripUnitSuffix` checkup normalizer/finding for the cleaning workflow.
3. **A1 + NEW-4** (`a993f40`) — `parseWorkbookFile` detects CSV/TSV and reads with SheetJS
   type-guessing disabled (`raw: true`, text-mode read), so `<0.5` and `3/6/2024` arrive as
   literal strings instead of being silently guessed into dates; clean numeric text is still
   coerced via `coerceNumbers`. `detectGrain` (the "did you mean per-patient?" check) now
   falls back to any ID-like column with repeats (not just one literally named after the
   entity), so a file keyed on `CSN` or similar still triggers the grain question.
4. **A2** (`3cadb9e`) — compound questions like "how many patients with UTI had
   duration_days over 7" no longer silently drop the duration clause. New
   `resolveConditions()` tries to resolve leftover words as a second AND-ed condition;
   when that fails it returns a `"partial"` status with a message naming exactly what was
   and wasn't understood, instead of answering with a truncated understanding.
5. **P0-3** (`c273a0e`) — `buildRequestParams(model, {...})` omits the `thinking` param
   entirely for models that don't support adaptive thinking (Haiku 4.5), instead of always
   sending it and getting a 400.
6. **P0-4** (`732553b`) — the "which test and why" note for a contingency table is now
   honest for R×C tables too: only claims "all expected counts >= 5" when that's true;
   an R×C table with a sparse cell keeps chi-square (no exact substitute exists) but says
   plainly that the p-value may be unreliable. A `reliable` flag lets the conclusion line
   add a caution sentence.
7. **P0-5 + NEW-6** (`457379a`) — a zero-variance t-test group now refuses in plain English
   ("no variation to test" / states the exact difference with no variability estimate)
   instead of showing literal `NaN`.

Deferred within these items (noted but not built, low-value/out of scope for this pass):
none — all six subitems of each finding above were addressed, including the Excel-step
and replay consistency requirements.

## What's NOT done — the remaining queue, in the order the handoffs specify

From `.claude/prompts/fix-2026-07-06-audit-findings.md`:
- **P1-6..P1-12**: chart crash on large data; censored-values "exclude" Excel/app mismatch;
  trimCase broken VLOOKUP fallback + fragile Y/Z helper columns; wrong Excel row refs with
  blank/padding rows; first-sheet-only silently used; worker "no network" claim is false;
  Shelf reshape collision silently overwritten. Dataset fixtures for these:
  NEW-3 (trailing-space/newline category variants → P1-8), NEW-4's reshape half
  (→ P1-12, patient-count half already done above).
- **P2-13..P2-23**: smaller correctness/polish items (sentinel-blank COUNTA mismatch,
  line-chart order, pie single-slice, unescaped COUNTIFS wildcards, duplicate-header
  rename collision, reportCards cross-group sums, mislabeled worker errors, saveRecipe
  overwrite, cost estimate staleness, t-test raw-value cap, plaintext API key disclosure).

From `.claude/prompts/handoff-2026-07-06-accuracy-ux.md` (its own suggested order):
- **A3 Level 1** (small, high trust payoff) — aggregation/group words (`average`, `per`,
  `by`) currently produce a fake "add a Definitions row" message; should be an honest
  capability message routed to the miss log.
- **A4** — example prompt chips all fail without an API key; add a working
  "answered on this computer" example group.
- **A5** — cleaning log must only vouch for genuinely valid dates (should now be easy: it
  can check `parseDates`'s validity logic from P0-1).
- **B1–B5** — the novice UX core: collapse the 9-card step wall into goal-grouped
  sections; add "Try it with example data" (synthetic only); scroll-to-result + a small
  session history; Undo/Start over (keep `originalWorkbook`); `beforeunload` warning +
  localStorage persistence of the log/recipe. This is sized like its own UI pass.
- **A3 Level 2** (biggest capability win, sized like its own small phase) — implement
  offline `sum`/`average`/`distinct` over a resolved numeric column and group-by for
  `GROUP_WORDS`, with matching Excel steps (AVERAGEIFS etc., the system prompt already
  teaches the AI path this).
- **B6–B12** — per-column profile table (flags empty/constant/text-numbers — NEW-6 and
  NEW-5 are ready-made fixtures), in-app Definitions editor, reactive privacy badge, chart
  polish (numeric-only value dropdown, PNG download, sort), stats/regression pickers
  badged by type (also ready-made from NEW-6's empty/constant columns), AI retry, a11y
  quick pass.
- **A6** — let the user pick the surviving spelling in category merges (small, standalone).

From `.claude/prompts/datasets-2026-07-09-realworld-examples.md`, items not yet folded in:
NEW-3 (trailing-space/newline categories → P1-8/A6), NEW-5 (numbers-as-text with a lone
real float → coerceNumbers/B6), NEW-7 (multi-value `;`/newline cells, incl. multi-date
cells that must NOT be corrupted by the date fix — new capability, unscoped), NEW-8
(sentinel strings that are NOT missing, e.g. "No Culture" — inverts P2-13), NEW-9
(inconsistent Yes/No vs YES/NO casing — category normalization), NEW-10 (redundant
near-duplicate columns — B6 profiling only, no engine change).

## Why this is a good stopping point

Everything above the line is either a P0 (silent-wrong-answer class bug) or directly
interacts with one (NEW-1/NEW-2/NEW-4/NEW-6). Everything below the line is P1/P2 polish
or a genuinely new UX/feature build (B1–B12 is a UI redesign; A3 Level 2 is a new offline
aggregation engine) — each sized like its own session, per the original handoffs'
"suggested order" notes.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout fix/2026-07-09-audit-findings`
2. `npx vitest run` — confirm still 194 passing before starting new work.
3. Continue in the combined execution order above: A3 Level 1 + A4 + A5 next (small,
   high-trust-payoff), then B1–B5, then A3 Level 2, then the rest.
4. Same per-item workflow: reproduce → failing test with a synthetic fixture → fix →
   full suite green → commit named by finding id. Do not push.
