# TidyTable — Handoff after P0 (all) + P1-1 (list+sort) of the steps-2/3/9 queue (2026-07-11)

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to `main`
without the owner's explicit go-ahead (pushing publishes the live site at
https://jojohuhu-git.github.io/TidyTable/). Currently `main` is **ahead of
origin/main by 5** (2 pre-existing local commits + 3 from this session).

Baseline was **761 passing tests**; now **777 passing (129 files)**, all green,
working tree **clean** at commit `6ab2cd4`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work:
**never guess, never silently drop data.** Folder is cloud-synced — commit
locally often. Queue/spec being executed:
`.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md` (execute in its
own "Execution order" section). PRIVACY: never read the owner's real files
(e.g. "Copy of DC antibiotics test file.xlsx") — synthetic fixtures only.

## What's done (by item ID) — 3 commits this session

1. **P0-1** — `c4d68d8`. Leading request verbs ("show me all", "list all",
   "pull out"…) are stripped before the matcher resolves terms, so they no
   longer trigger the scary "undefined clinical term" Definitions block. Block
   message reworded to plain English (in-app form first, Definitions sheet as
   optional aside). Files: `src/logic/offline/matcher.js` (`stripRequestLead`),
   `src/logic/offline/runOffline.js` (`buildBlockMessage`). Tests:
   `src/logic/offline/fix-2026-07-11-p0.test.js`. Fixes R1/R2. Live-verified.

2. **P0-2 / P0-3 / P0-4** — `8118f6d` (tightly coupled, one commit).
   P0-2: teach-it form only shown for word-resolution declines
   (`TEACHABLE_DECLINE_REASONS`); unsupported operations (sort/list/reformat)
   show a plain capability message, no form. P0-3: a post-teach re-run that
   still declines no longer re-shows the form (the old "Remember this does
   nothing" loop) — it shows the honest reason; the alias is still saved.
   P0-4: every teach/alias save shows a "Learned: …saved for this file."
   confirmation line. Files: `src/App.jsx`, `src/logic/offline/runOffline.js`.
   Tests: `src/fix-2026-07-11-p0.dom.test.jsx`. Fixes R3's loop + dead-button
   complaint. Live-verified (sort → capability message + no form; teach a text
   column for a sum → Learned line + honest stop, no loop).

3. **P1-1 (list + sort only)** — `6ab2cd4`. New offline `list` intent: "show
   me / list / pull out the rows where…" returns the matching rows themselves
   (reusing `executeCohort`'s matched rows), with an optional sort ("newest
   first", "sorted by X", "highest first"). All three surfaces: result table,
   Excel recipe (Data > Filter + Data > Sort), runnable dplyr filter/arrange R
   script; worker transform reproduces the download. Counting/ranking intents
   still win ("show me how many…" stays a count). Files:
   `src/logic/offline/matcher.js` (`detectListVerb`, `parseSortModifier`,
   `matchList`, `describeLookedForList`), `src/logic/offline/fillPlan.js`
   (`fillListPlan` + list branch in `fillPlan`/`summarizeAnswer`). Tests:
   `src/logic/offline/fix-2026-07-11-p1-1-list.test.js`. Fixes **R1 and R3**
   (both now real answers). Live-verified end-to-end (3-row result table +
   Excel + RStudio surfaces).

## What's NOT done — the remaining queue (all from the fix-2026-07-11 spec)

Deferred/split out of P1-1:
- **P1-1b** (new, tracked) — **R5** "show me the rows where lab value is
  missing" needs a new `blank`/missing filter primitive. Must be added to
  `resolveCondition` (parse "is missing/blank/empty"), `cohort.js` `predicate()`,
  `conditionPhrase()`, R filter + Excel crit, AND every inline transform `pred`
  copy in `fillPlan.js` (count/group/agg/describe/topN/list) for five-surface
  parity. Its own test-first commit.

Not started (execution order):
- **P1-2** — Fix **R4** "average duration for UTI": treat a trailing "for
  <value>"/"in <value>" as a cohort filter so the target column resolves (or
  ask a did-you-mean). Root cause confirmed: "for UTI" isn't a COHORT_MARKER,
  so the cohort clause isn't stripped and `resolveAggregationTarget` can't
  isolate "duration". Moderate matcher change.
- **P1-3** — Wire `foldWord` into `valueMatch.js` scoring so plurals match
  (fixes **R6**); fold-only matches are `stretched` (confirm chip), keep the
  prescriber/prescription trap separated.
- **P1-4** — Pooled multi-column ranking (owner's DC-antibiotics workflow):
  count/top-N over 2+ columns, a no-typing "Combine columns and rank" control,
  remembered counting-policy clarify, all three outputs + chart.
- **P2-1 / P2-2 / P2-4 / P2-3** — Step 2 calm-down (one-line findings, safe/
  needs-your-call groups, per-step "How to use this step" panels, plain-English
  cleaning box).
- **P3-1 / P3-2 / P3-3** — Step 9 inherits Step 3, interim two-column decline,
  request-aware chart highlighting. (Load the `dataviz` skill before P3-3.)
- **P6-1 / P6-2 / P6-4 / P6-3 / P6-5** — complex graphics (stacked/grouped/100%
  bars, histogram + box/dot, cohort wording, Pareto, small multiples).
- **P5-1 / P5-2 / P5-3 / P5-6** then **P5-4 / P5-5** — publication exports
  (zero-dep clipboard/SVG first; then pptxgenjs + docx [also delivers P4-5], and
  ggplot2). Owner already approved the two lazy-loaded MIT deps.
- **P4-1 / P4-2 / P4-6 / P4-4** then **P4-3** — robustness/reach (per-column
  alias keying, real dates, miss/hit UI, all-sheets Step 2, validation-list
  vocabularies).

All decisions A–E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask them.

## Why this is a good stopping point

All of P0 (the entire first phase of the execution order) plus P1-1's headline
capability are complete, each as a self-contained, tested, committed, live-
verified unit. The suite is green at 777. Nothing left in the queue is blocked
by this work — the next session can start P1-1b or P1-2 immediately against a
clean baseline.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — confirm **777 passing (129 files)** before any work.
3. No open owner decisions — the spec resolves them all. If a NEW judgment call
   surfaces mid-item, ask the owner, don't default.
4. Per item (fix-queue skill): reproduce with a synthetic fixture → failing
   test first → minimal fix (mirror to all surfaces) → full suite green →
   live-verify in the browser (`preview_start`, name "TidyTable dev server",
   port 5175) → commit named by item ID.
5. Push/deploy only on the owner's explicit say-so. Commit locally per item
   (cloud-sync reversion risk).
