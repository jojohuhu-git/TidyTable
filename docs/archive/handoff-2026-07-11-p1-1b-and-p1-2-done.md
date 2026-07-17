# TidyTable — Handoff after P1-1b (blank filter) + P1-2 (cohort target) of the steps-2/3/9 queue (2026-07-11)

> **SUPERSEDED** — see
> [handoff-2026-07-11-p1-3-done-p1-4-started.md](handoff-2026-07-11-p1-3-done-p1-4-started.md).
> P1-3 is now done too, and P1-4 is in progress (failing test written, engine
> not yet implemented). Resume from that file, not this one.

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site at
https://jojohuhu-git.github.io/TidyTable/). `main` is currently **ahead of
origin/main by 8** (3 earlier local commits + 3 from the prior session's handoff
chain + 2 from this session).

Baseline this session was **777 passing tests**; now **790 passing (131 files)**,
all green, working tree **clean** at commit `d9efd9c`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work:
**never guess, never silently drop data.** Folder is cloud-synced — commit
locally often. Queue/spec being executed:
`.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md` (follow its
"Execution order" section). PRIVACY: never read the owner's real files
(e.g. "Copy of DC antibiotics test file.xlsx") — synthetic fixtures only.

## What's done (by item ID) — 2 commits this session

1. **P1-1b** — `9950eb3`. New `blank` condition kind so **R5** ("show me the
   rows where lab value is missing") is a real answer, not an "I can't pull out
   rows" decline. "Missing" = the SAME sentinel set Step 2's cleanup recognizes
   (null, "", N/A, na, none, -, .); a censored `<0.5` is a real value, NOT
   missing. "present"/"recorded" is the honest opposite. Mirrored across every
   surface: `matcher.js` (`detectBlankCondition`, `conditionPhrase`, the list
   `hasCondition` gate), `cohort.js` `predicate()` + new `isMissingCell()`, all
   inline worker-transform `pred` copies in `fillPlan.js`
   (count/group/agg/describe/topN/list) via a shared `needsFilterFallback()`
   helper, the dplyr R filter (`is.na` + sentinel set), and the Excel recipe
   (Data > Filter to Blanks + N/A markers, routed through the same
   COUNTIFS-can't-do-this fallback the "one of" set already used). Tests:
   `src/logic/offline/fix-2026-07-11-p1-1b-blank.test.js` (7). Live-verified:
   R5 lists the 2 N/A rows, "Listing the rows where Lab_value is missing
   (blank / N/A) … Found 2 rows out of 6".

2. **P1-2** — `d9efd9c`. Fixes **R4** ("average duration for UTI"), which used
   to dead-end with "couldn't tell which column of numbers to average" because
   "for UTI" is not a cohort marker, so "UTI" stayed glued to the target phrase.
   New `detectTrailingValueCohort()` in `matcher.js`: on an aggregation request
   with no cohort marker, a trailing "for/in/with/among &lt;value&gt;" whose
   phrase is an EXACT existing cell value is peeled off as a cohort filter
   (never guessed — a non-existent phrase like "for narnia" still declines
   honestly). Shaped like `extractCohort` so `matchAggregation` + the
   target-search stripping reuse it unchanged; rightmost marker wins, tolerates
   a trailing entity noun ("for UTI patients"). Tests:
   `src/logic/offline/fix-2026-07-11-p1-2-cohort-target.test.js` (6).
   Live-verified: "Averaging Duration_days where Diagnosis is UTI … 7.5 days
   across 2 rows", no decline.

## What's NOT done — the remaining queue (all from the fix-2026-07-11 spec)

Next up (execution order):
- **P1-3** — Wire `foldWord` into `valueMatch.js` scoring so plurals match
  (fixes **R6** "diagnoses by number of patients"). `foldWord` is imported but
  deliberately unused (`void foldWord`, ~line 22-23) in `scoreTokenMatch`.
  **Traps to respect:** fold-only matches must be `stretched` (confirm chip),
  NOT silent — the never-guess promise. Keep the "prescriber vs prescription"
  separation (the families table handles it). Existing w2/phase3 tests must stay
  green. After the fix, re-test R6 through the Step-9 "one brain" path
  (`textToChart` calls `matchRequest`), not just Step 3.
- **P1-4** — Pooled multi-column ranking (owner's DC-antibiotics workflow):
  count/top-N over 2+ columns, no-typing "Combine columns and rank" control,
  remembered counting-policy clarify, all three outputs + chart.
- **P2-1 / P2-2 / P2-4 / P2-3** — Step 2 calm-down (one-line findings, safe/
  needs-your-call groups, per-step "How to use this step" panels, plain-English
  cleaning box).
- **P3-1 / P3-2 / P3-3** — Step 9 inherits Step 3, interim two-column decline,
  request-aware chart highlighting. (Load the `dataviz` skill before P3-3.)
- **P6-1 / P6-2 / P6-4 / P6-3 / P6-5** — complex graphics (stacked/grouped/100%
  bars, histogram + box/dot, cohort wording, Pareto, small multiples).
- **P5-1 / P5-2 / P5-3 / P5-6** then **P5-4 / P5-5** — publication exports.
- **P4-1 / P4-2 / P4-6 / P4-4** then **P4-3** — robustness/reach.

All decisions A–E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask them.

## Why this is a good stopping point

The two capability gaps the prior handoff named as immediately-ready (P1-1b and
P1-2) are both complete — each reproduced, failing-test-first, fixed across every
surface, full suite green (790), and live-verified in the browser. Nothing in the
remaining queue is blocked by this work. P1-3 is a deliberate boundary: it edits
the core token-scoring subsystem and carries the "prescriber vs prescription"
trap, so it deserves its own fresh session rather than a rushed tail-end.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — confirm **790 passing (131 files)** before any work.
3. No open owner decisions — the spec resolves them all. If a NEW judgment call
   surfaces mid-item, ask the owner, don't default.
4. Per item (fix-queue skill): reproduce with a synthetic fixture → failing
   test first → minimal fix (mirror to all surfaces) → full suite green →
   live-verify in the browser (`preview_start`, name "TidyTable dev server",
   port 5175) → commit named by item ID. Note: the dev server here bound to an
   autoport (5175 was busy) and browser screenshots rendered blank in this
   session — DOM text via `get_page_text`/`javascript_tool` is the reliable
   live-verify path; a page reload from HMR resets the loaded example data, so
   re-click "Try it with example data" after edits.
5. Push/deploy only on the owner's explicit say-so. Commit locally per item
   (cloud-sync reversion risk).
