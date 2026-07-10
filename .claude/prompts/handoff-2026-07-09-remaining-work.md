# TidyTable — Handoff after the 2026-07-09 P0/A1/A2/A3/B/P1 pass

Branch: `fix/2026-07-09-audit-findings`, off `phase/5-charts`. **Not pushed** — 16 commits,
all local, owner reviews before anything hits GitHub. Baseline was 141 passing tests;
now **270 passing (39 files)**, all green, working tree clean at commit `65de628`.

## What's done (by finding id) — see commit log for full detail on each

Everything below is complete and committed. Commits, oldest first:
`a993f40` `3cadb9e` `c273a0e` `732553b` `457379a` `5d75bb7` `71d6336` `333cb85` `ea20a30`
`c35ffe5` `f14d541` `2cb1c7c` `c5529a2` `65de628`.

### P0s (from `fix-2026-07-06-audit-findings.md`) + their dataset interactions
1. **P0-1 + NEW-1** — `parseDates` validates month/day/calendar before rewriting; asks the user
   per-column when date order is ambiguous via `ClarifyBox`/`needsPolicy`. New `epochSerialToNumber`
   normalizer + `findEpochDates` checkup finding recovers real `.xlsx` columns Excel mis-typed as
   dates near its 1899-12-30 epoch.
2. **P0-2 + NEW-2** — `toNumber` in the offline engine returns `null` (not 0) for non-numeric text,
   censored markers, and ranges; strips a trailing unit suffix (`"5 Days"` → `5`) first so legitimate
   unit-suffixed durations aren't dropped. `executeCohort` reports `skippedCount`/`skippedColumn`.
3. **A1 + NEW-4** — CSV/TSV parsed with SheetJS type-guessing disabled (`raw: true`), so `<0.5` and
   `3/6/2024` arrive as literal strings; `detectGrain` falls back to any ID-like repeating column,
   not just one named after the entity.
4. **A2** — compound questions ("...UTI...duration_days over 7") no longer silently drop the second
   condition; `resolveConditions()` tries to resolve leftover words as a second AND-ed condition, or
   returns an honest `"partial"` status naming exactly what wasn't understood.
5. **P0-3** — `buildRequestParams` omits `thinking` entirely for models that reject it (Haiku 4.5).
6. **P0-4** — the "which test and why" note only claims "all expected counts >= 5" when true for
   R×C tables; a sparse cell adds a plain reliability caveat instead of a false claim.
7. **P0-5 + NEW-6** — a zero-variance t-test group refuses in plain English instead of showing `NaN`.

### A3 — aggregation/group-by (both levels)
8. **A3 Level 1** (`5d75bb7`) — average/sum/per-X/by-X declined as an honest capability gap
   (logged to the miss log) instead of a fake "add a Definitions row" prompt.
9. **A3 Level 2** (`f14d541`) — the real feature: offline `sum`/`average`/`distinct` over a resolved
   numeric/target column, plus group-by breakdowns for `GROUP_WORDS` ("how many patients per
   diagnosis" → one row per diagnosis with count+share; "average duration_days per diagnosis" →
   per-group averages). Matching `AVERAGEIFS`/`SUMIFS` Excel steps per group; an honest
   Remove-Duplicates instruction for distinct (no formula can list several accepted values). Key
   files: `src/logic/offline/matcher.js` (`resolveGroupBy`, `resolveAggregationTarget`,
   `matchAggregation`), `src/logic/offline/cohort.js` (`executeAggregation`), `src/logic/offline/
   fillPlan.js` (`fillAggregationPlan`, `fillGroupCountPlan`). Verified live in the browser
   (uploaded CSV, asked both an aggregation and a group-by question, correct Excel formulas, no
   console errors).

### A4, A5 (small, already-shipped Level-1-adjacent items)
10. **A4** (`71d6336`) — `buildOfflineExample()` builds a verified "answered on this computer"
    example chip from the user's real headers, shown above the AI-only examples in `PromptPanel`.
11. **A5** (`333cb85`) — the cleaning log's date-validity check now shares one source of truth
    (`isValidCalendarDate` in `normalizers.js`) with `parseDates`, instead of a second copy that
    merely happened to agree.

### B1-B5 — novice UX core (`2cb1c7c`)
12. **B1** — Steps 5-10 collapse into three goal-grouped `<details>` sections (Monthly routine /
    Analyze & chart / Reshape), collapsed by default. Fixed the pre-upload "Step 1 then Step 6"
    broken numbering: the replay tool shows under a plain "Already have a saved recipe?" heading
    before a file is loaded, and under "Step 6" once one is.
13. **B2** — "Try it with example data" next to the dropzone loads a synthetic two-sheet workbook
    (`src/logic/exampleWorkbook.js`) built from the same messy patterns the test suite uses
    (duplicate rows, missing/censored values, mixed dates, text numbers).
14. **B3** — every run gets a "Result of: ..." label, scrolls into view (`resultsRef` +
    `requestAnimationFrame` scrollIntoView), and lands in a clickable session-history strip
    (`runHistory`/`activeHistoryId` state in `App.jsx`) so an earlier answer isn't lost.
15. **B4** — single-slot "Undo last apply" (`undoSnapshot` — reverts sheet + log + recipe together)
    and "Start over" (`originalWorkbook` — back to the file as uploaded). Verified live: applied a
    fix, undid it, confirmed the checkup's duplicate-row finding reappeared.
16. **B5** — session log + in-progress recipe persist to `localStorage`
    (`src/logic/sessionPersistence.js`, key `tidytable_session_v1`) across a refresh; the workbook
    itself is NOT persisted (re-upload still needed). `beforeunload` warns while a workbook is loaded.

### P1-6 through P1-12 (from `fix-2026-07-06-audit-findings.md`) — all seven done
17. **P1-11** (`c5529a2`) — `WORKER_SOURCE` shadows `fetch`/`XMLHttpRequest`/`WebSocket`/
    `EventSource`/`importScripts` before running generated transform code (hardening, not a real
    sandbox — the comment says so). Tested via a `vm` context standing in for `self` (a plain
    object wouldn't reproduce `self === globalThis` aliasing that lets bare `fetch` resolve to the
    shadowed one).
18. **P1-8** (`c5529a2`) — trimCase's older-Excel VLOOKUP fallback was a one-column-range,
    index-1 no-op; fixed to a two-column range with index 2. Its lookup columns now allocate from
    the same helper-column sequence as every other fix (`buildFixPlan.js`'s `helperIndex`) instead
    of hardcoded Y/Z, so they can't collide with real data or another fix's helper column.
19. **P1-7** (`c5529a2`) — censoredValues' "exclude" policy (a no-op in the app) now gets its own
    honest Excel instruction (no formula; filter these out before counting/averaging) instead of
    the "boundary" formula, which would have converted `<0.5` to `0.5` in Excel while the app left
    it as text.
20. **P1-9** (`c5529a2`) — every Excel-step generator assumed "row 2 to rows.length+1". Now
    `parseWorkbookFile` records the real physical extent
    (`excelFirstDataRow`/`excelLastRow`/`droppedBlankRows` on the sheet object); `excelRowExtent()`/
    `excelRowExtentNote()` in `workbook.js` are the shared readers, used by every Excel-step
    builder (checkup fixes, cohort/group-by/aggregation offline answers) and the AI data context,
    prepending a one-sentence honesty note to the first step when the sheet isn't tidy.
21. **P1-12** (`c5529a2`) — `reshapeLongToWide`'s collision count was computed but never shown;
    `ShelfPanel` now surfaces a notice when `collisions > 0`. A measure literally named the same as
    the id column no longer overwrites the id (renamed to `"<name> (value)"`).
22. **P1-6** (`65de628`) — replaced `Math.max(...bigArray)` (throws `RangeError` past the JS engine's
    argument-spread limit — verified with a 300k-element array) with `maxOf()`, a reduce loop, across
    Bar/Line/Scatter chart previews and `ReportCardsView`. Scatter datasets over 2,000 points are
    sampled down (evenly spaced) with an honest "showing a sample of N of M points" note. A
    categorical dataset past ~30 distinct groups declines a bar-per-category chart plainly instead
    of rendering one (a long time series is unaffected — it gets a line, not bars).
23. **P1-10** (`65de628`) — Steps 7-9 and the Reshape step's base side now disclose "only the first
    sheet, 'X', is used here" (matching the pattern Step 2's checkup intro already used) when a
    workbook has more than one sheet. This is the audit's allowed "minimum honest version" instead
    of a full active-sheet selector; the offline matcher's summary already names the sheet
    ("Starting from N rows in 'SheetName'").

Deferred within these items: none — every subitem of every finding above was addressed.

## What's NOT done — the remaining queue

From `.claude/prompts/fix-2026-07-06-audit-findings.md`:
- **P2-13..P2-23** — smaller correctness/polish items (sentinel-blank COUNTA mismatch, line-chart
  chronological order, pie single-slice/negative-value handling, unescaped COUNTIFS wildcards,
  duplicate-header rename collision, reportCards cross-group sums, mislabeled worker/transform
  errors in `runViaClaude`, `saveRecipe` overwrite, cost-estimate staleness, t-test raw-value cap,
  plaintext API key disclosure copy). None started. Each is small and independent — good for a
  short session or to batch a few at a time.

From `.claude/prompts/handoff-2026-07-06-accuracy-ux.md`:
- **B6-B12** — per-column profile table (flags empty/constant/text-numbers — NEW-5/NEW-6 are
  ready-made fixtures), in-app Definitions editor, reactive privacy badge, chart polish
  (numeric-only value dropdown, PNG download, sort), stats/regression pickers badged by type, AI
  retry, a11y quick pass. Sized like its own UI pass — B1-B5 (the novice UX core) is done, this is
  the next tier of polish on top of it.
- **A6** — let the user pick the surviving spelling in category merges (small, standalone;
  `findCategoryVariants` already shows the `"x" -> "y"` chips, just needs to make the canonical
  choice clickable).

From `.claude/prompts/datasets-2026-07-09-realworld-examples.md`, not yet folded in:
- **NEW-3** (trailing-space/newline category variants → P1-8/A6 scope, but not the VLOOKUP part
  already fixed — this is about the *matching* logic finding these as variants, separate work)
- **NEW-5** (numbers-as-text with a lone real float → `coerceNumbers`/B6 profiling)
- **NEW-7** (multi-value `;`/newline cells, incl. multi-date cells that must NOT be corrupted by
  the date fix — new capability, unscoped)
- **NEW-8** (sentinel strings that are NOT missing, e.g. "No Culture" — inverts P2-13)
- **NEW-9** (inconsistent Yes/No vs YES/NO casing — category normalization)
- **NEW-10** (redundant near-duplicate columns — B6 profiling only, no engine change)

## Why this is a good stopping point

Every P0 and every P1 from the confirmed-bug audit is done. A3 (both levels) and B1-B5 (the novice
UX core) — the two biggest capability/UX items from the accuracy-ux handoff — are done. What's left
is P2 polish (smaller, independent, no particular order), B6-B12 (a second UI pass, sized like its
own session), A6 (small, standalone), and the NEW-3/5/7/8/9/10 dataset items (each its own small
scoped fixture-driven fix). None of it is P0/P1-severity or blocks anything else.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout fix/2026-07-09-audit-findings`
2. `npx vitest run` — confirm **270 passing (39 files)** before starting new work.
3. **Open decision, ask the owner before picking one** — these don't block each other:
   - **P2-13..P2-23** — a batch of small, independent polish fixes. Good if you want quick,
     low-risk wins; do a few at a time with a test each, same workflow as the P1 batch.
   - **B6-B12** — the next UI/polish pass on top of B1-B5 (profile table, Definitions editor,
     privacy badge, chart polish, stats/regression type badges, AI retry, a11y). Sized like its
     own session.
   - **A6** — small and standalone (category-merge canonical-spelling picker); could be a quick
     add-on to either of the above.
   - **NEW-3/5/7/8/9/10** — dataset-driven items, each its own small scoped fix.
   Do not default to any one without checking — whichever the owner wants next is fine to start
   cold, per-item workflow below applies to all of them.
4. Same per-item workflow as every prior pass: reproduce → failing test with a synthetic fixture →
   fix → full suite green → commit named by finding id (or a short descriptive name for B/A items).
   For anything UI-observable, verify in the running app (`preview_start` → upload/interact →
   screenshot/console-check) before calling it done, not just the test suite.
5. Do not push — branch is local-only, owner reviews before anything hits GitHub.
