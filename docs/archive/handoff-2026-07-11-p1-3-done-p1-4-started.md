# TidyTable — Handoff after P1-3 (plural folding) done, P1-4 (pooled ranking) started (2026-07-11)

Branch: `main`, off `main`. **Pushed 1 commit ahead of origin** (`3a2276f`,
P1-3) — TidyTable rule: never push to `main` without the owner's explicit
go-ahead (pushing publishes the live site at
https://jojohuhu-git.github.io/TidyTable/). The owner asked this session to
do P1-3 **and** P1-4 together, then push both — but P1-4 is not finished, so
**nothing new has been pushed since P1-3 landed locally.** `git status -sb`
shows `main...origin/main [ahead 1]`.

Baseline this session was **790 passing tests (131 files)**, from
[handoff-2026-07-11-p1-1b-and-p1-2-done.md](handoff-2026-07-11-p1-1b-and-p1-2-done.md)
(now superseded — see its banner). After P1-3: **799 passing (132 files)**,
all green, clean tree at commit `3a2276f`. P1-4's new test file is
**uncommitted and RED** (6 failing tests, function not yet implemented) — see
below.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec being executed:
`.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md` (follow its
"Execution order" section). PRIVACY: never read the owner's real files —
synthetic fixtures only.

## What's done (by item ID) — 1 commit this session

1. **P1-3** — `3a2276f`. Fixes **R6** ("diagnoses by number of patients" in
   Step 9), which used to dead-end with "I couldn't tell which column to
   compare" because `scoreTokenMatch` in `src/logic/offline/valueMatch.js`
   compared raw tokens only (`foldWord` was imported but deliberately
   unused, `void foldWord`). Added a fold-tier retry: if the raw comparison
   finds no match, both sides are folded via `foldWord` (wordforms.js) and
   re-scored — but ONLY as an all-words-EQUAL match (score 2 or 3 pre-fold),
   never a mere prefix, and the result is reported as score `0.5`, below
   every literal tier. Every caller already treats any non-exact score as a
   stretch to CONFIRM (not a silent answer), so the never-guess promise
   holds; "prescriber" vs "prescription" stays separated because the
   wordforms families table already keeps them apart. Tests: 9 new cases
   folded into the existing `valueMatch`/`w2`/`phase3` test files (all
   green — no regression to the "prescriber vs prescription" trap or the
   raw-token tests). Live-verify: **not yet done this session** — do it
   before considering P1-3 fully shippable (drive Step 9 with "diagnoses by
   number of patients" against the example workbook and confirm a
   Diagnosis-column confirm chip appears, then accepting it draws the
   chart).

## What's IN PROGRESS — P1-4 (pooled multi-column ranking)

**Scope decision (owner, this session):** P1-4 is split in two so nothing
half-built gets pushed:
- **P1-4a** (this session, in progress) — the full TYPED capability: offline
  pooled-ranking engine, result table, Excel recipe, R (`pivot_longer`)
  script, remembered counting-policy clarify, and the Step-9 chart one-brain
  path. Usable by typing e.g. "most common values across UTI and other
  cUTI".
- **P1-4b** (deferred, not started) — the no-typing "Combine columns and
  rank" checkbox control (Step 3 example area / Step 9 pickers) and
  verification against the packed-cell splitter (Step 2) for multi-select
  validation cells.

**What exists right now:** a FAILING test file,
`src/logic/offline/fix-2026-07-11-p1-4-pooled-rank.test.js` (uncommitted,
untracked — `git status` shows it). It specifies the engine layer only:
- `rankFrequencyPooled(rows, columns, policy, entityColumn?)` — new export
  needed in `src/logic/offline/cohort.js`, sibling to the existing
  `rankFrequency`/`rankMagnitude`. Pools 2+ named columns into one tally.
  Three counting policies (Decision D, owner-approved 2026-07-11, default =
  `"occurrence"`):
  - `"occurrence"` — count every non-blank cell across the chosen columns.
  - `"row"` — count a value once per row even if it appears in more than one
    of the chosen columns on that row.
  - `"patient"` — count a value once per entity (patient) across all their
    rows; needs an `entityColumn` (e.g. `PatientID`).
  Returns `{ entries: [{label, count}], mentions, blankCells, total }` — the
  test fixture (2 picklist columns, a same-row duplicate, a repeat patient,
  two blanks) is built specifically to give the three policies different
  numbers, so the fixture itself documents the semantics.
- `executePooledRank(match, workbook)` — new export needed in `cohort.js`,
  sibling to `executeTopN`. Takes a match shaped
  `{ sheetName, stages, pooled: { columns, policy, n, direction } }`, runs
  the existing `stages`/`predicate()` filter machinery first (same as every
  other execute* function), then ranks via `rankFrequencyPooled` +
  `topNWithTies` (both already exist and are reused, not reimplemented).
  Returns `{ ranked, mentions, distinctValues, total, ... }`.

**Nothing is implemented yet** — running `npx vitest run` right now shows 6
failing tests (`TypeError: executePooledRank is not a function`, etc.) on
top of the 799 passing baseline. This is the expected TDD state: reproduce →
**failing test written and confirmed red** → [fix not started].

## What's NOT done — the remaining queue

Next up, in order, once P1-4a's engine layer is implemented and green:
- **P1-4a continued** (same item, not a new ID):
  1. Engine (`cohort.js`) — described above, currently red.
  2. Detection in `matcher.js` — recognize phrasings "most common values
     across X and Y", "combine X and Y and rank the types", "rank
     everything in X and Y together"; resolve 2+ column names (reuse the
     existing column-resolution machinery, not a new implementation);
     produce a `pooled` match shape parallel to `topN`.
  3. Counting-policy clarify — ask once per file signature, remember it like
     `grainStore.js` does for grain mode (mirror that store's pattern: a
     new small store keyed by file signature, holding only the policy
     choice — never a cell value, same privacy boundary). Default
     suggestion per Decision D: occurrences for "values", patients when the
     grain memory already says per-patient for this file.
  4. Result table, Excel recipe (helper stacked-range / COUNTIF over both
     ranges, reproducible by hand — follow the existing
     `buildTopNFrequencyExcelSteps` pattern in `fillPlan.js` as the
     precedent for "Excel has no native formula for this, give a PivotTable
     + spot-check COUNTIFS" phrasing), R script (`pivot_longer` on the
     chosen columns + count).
  5. Chart one-brain path — `textToChart.js`'s `chartPlanFromMatch` needs a
     new branch for a `pooled` match, parallel to its existing `topN`
     branch (~line 172); "chart the UTI types across UTI and other cUTI" →
     bar.
  6. Live-verify all of the above end-to-end (dev server, drive the actual
     flow — a green suite is not proof).
  7. Commit as `P1-4a: ...`.
- **P1-4b** (deferred, scope agreed but not started): no-typing "Combine
  columns and rank" checkbox control; packed-cell splitter interaction
  check.
- **P2-1 / P2-2 / P2-4 / P2-3** — Step 2 calm-down (one-line findings, safe/
  needs-your-call groups, per-step "How to use this step" panels, plain-
  English cleaning box).
- **P3-1 / P3-2 / P3-3** — Step 9 inherits Step 3, interim two-column
  decline, request-aware chart highlighting. (Load the `dataviz` skill
  before P3-3.) Note: P3-1 says "re-test R6 after P1-3" — that live-verify
  is still outstanding (see P1-3 above).
- **P6-1 / P6-2 / P6-4 / P6-3 / P6-5** — complex graphics (stacked/grouped/
  100% bars, histogram + box/dot, cohort wording, Pareto, small multiples).
- **P5-1 / P5-2 / P5-3 / P5-6** then **P5-4 / P5-5** — publication exports.
- **P4-1 / P4-2 / P4-6 / P4-4** then **P4-3** — robustness/reach.

All decisions A–E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask them.

## Why this is a good stopping point

P1-3 is complete, tested, committed, and self-contained — it doesn't block
or get blocked by anything else in the queue. P1-4 was deliberately split so
the typed capability (P1-4a) can land as one coherent, fully-verified unit
without also carrying the UI-control work (P1-4b), which is a distinct
surface (Step 3 example area / Step 9 pickers) with its own verification
needs. The failing test file already on disk is the exact contract for what
"done" looks like for the engine layer — the next session does not need to
re-derive the counting-policy semantics, just implement to green.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo
   allows direct commits to main but **never push** without the owner's
   go-ahead).
2. Run `npx vitest run` — expect **799 passing, 6 failing** (the new P1-4
   engine test file) before any work. If the counts differ, stop and
   diagnose before continuing.
3. First task: implement `rankFrequencyPooled` and `executePooledRank` in
   `src/logic/offline/cohort.js` to make
   `src/logic/offline/fix-2026-07-11-p1-4-pooled-rank.test.js` pass. Follow
   the existing `rankFrequency`/`executeTopN` functions immediately above/
   below in the same file as the pattern to mirror (self-contained, no
   closures — `fillPlan.js` inlines these via `.toString()` into the worker
   transform, so keep them dependency-free the same way).
4. Then continue P1-4a steps 2–7 above (matcher detection → clarify/store →
   outputs → chart → live-verify → commit). No open owner decisions remain
   for P1-4a — Decision D already resolved the counting-policy default. If
   a NEW judgment call surfaces (e.g. exact phrasing wording), ask the
   owner, don't default.
5. Before moving on to P1-4b or P2, also close the outstanding P1-3
   live-verify noted above (drive Step 9 with "diagnoses by number of
   patients" in the browser).
6. Push/deploy only on the owner's explicit say-so — including the P1-3
   commit already sitting locally ahead of origin. Commit locally per item
   (cloud-sync reversion risk).
