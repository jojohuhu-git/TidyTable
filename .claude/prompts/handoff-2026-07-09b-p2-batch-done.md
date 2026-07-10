# TidyTable — Handoff after the P2-13..P2-23 batch (2026-07-09, same day as the P0/A1-A5/B1-B5/P1 pass)

Branch: `fix/2026-07-09-audit-findings`, off `phase/5-charts`. **Not pushed** — 26 commits
total, all local, owner reviews before anything hits GitHub. Baseline for this batch was 270
passing tests (see `handoff-2026-07-09-remaining-work.md`); now **297 passing (47 files)**, all
green, working tree clean.

## What's done in this batch

All eleven P2 items from `fix-2026-07-06-audit-findings.md`, each its own commit with a
synthetic-fixture test that fails on the pre-fix code:

1. **P2-13** (`2fe88cd`) — sentinelBlanks' Excel instruction no longer claims COUNTA ignores
   formula-blanked cells (it doesn't — `=IF(...,"",...)` still counts as text). Names the
   COUNTIF(range,"<>") workaround.
2. **P2-14** (`595dd53`) — `buildDataset` sorts time-like categorical labels (ISO dates, month
   names, quarters) chronologically via a new `timeSortKey()`; falls back to first-appearance
   order when a label doesn't resolve to a real date (e.g. a bare quarter with no year).
3. **P2-15** (`3266bc2`) — a 100%-share pie slice draws a `<circle>` instead of an invisible
   zero-length arc. The advisor never offers a pie when any value is negative; `BarChart` draws
   negative bars growing left of a zero axis instead of misreading them.
4. **P2-16** (`97013b4`) — new `escapeCriteria()` in `fillPlan.js` escapes `*`, `?`, `~` in every
   COUNTIFS/SUMIFS/AVERAGEIFS criterion (including `when` companion conditions), so a cell value
   containing an Excel wildcard character isn't wildcard-matched by the generated formula.
5. **P2-17** (`59634a6`) — duplicate-header renaming in `parseWorkbookFile` tracks every name
   actually assigned (not just a per-original-header counter), so "Name" (2nd occurrence) can't
   collide with a real pre-existing "Name (2)" column.
6. **P2-18** (`a9c4609`) — `reportCards.js` aggregates per (person, group) pair instead of per
   person, so someone appearing under two groups gets an honest total in each instead of one
   inflated total under whichever group their first row happened to be in.
7. **P2-19** (`5be2336`) — `runViaClaude` in `App.jsx` now catches the Claude API call and the
   local worker transform separately; only the API-call failure goes through `friendlyApiError`,
   so a transform bug is shown as-is instead of being reinterpreted as e.g. a rate-limit message.
8. **P2-20** (`c7c1709`) — `saveRecipe` auto-suffixes a name collision with a *different* recipe
   (`(2)`, `(3)`, ...) instead of overwriting it; re-saving the same recipe under its own name
   (same `createdAt`) is still recognized as an in-place update. `RecipePanel` surfaces the
   actual saved-as name when a collision happened.
9. **P2-21** (`3bac783`) — `estimateCostUSD` computes Sonnet 5's price from an injectable "now"
   instead of a hardcoded $2/MTok: $2 through 2026-08-31 (the real intro-price end date), $3
   after. Self-corrects rather than needing another manual edit later.
10. **P2-22** (`7c7f6b5`) — the t-test crosscheck step caps each group's inline value list at 50
    with an "...and N more" note, and offers a "Copy full lists" button (reused
    `ResultsPanel`'s now-exported `CopyButton`) for the complete data.
11. **P2-23** (`a257888`) — `ApiKeyPanel`'s "Remember on this computer" checkbox now shows a
    plain note when checked: stored unencrypted in this browser's storage, readable by anyone
    with access to this computer profile, use a low-limit key.

Deferred within these items: none.

## What's NOT done — the remaining queue (unchanged from the prior handoff)

- **B6-B12** — per-column profile table, in-app Definitions editor, reactive privacy badge,
  chart polish (numeric-only value dropdown, PNG download, sort), stats/regression pickers
  badged by type, AI retry, a11y quick pass. Sized like its own UI pass.
- **A6** — let the user pick the surviving spelling in category merges (small, standalone).
- **NEW-3/5/7/8/9/10** from `datasets-2026-07-09-realworld-examples.md` — dataset-driven items,
  each its own small scoped fix (trailing-space category variants, numbers-as-text profiling,
  multi-value cells, sentinel strings that aren't missing, Yes/No casing, near-duplicate
  columns).

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout fix/2026-07-09-audit-findings`
2. `npx vitest run` — confirm **297 passing (47 files)** before starting new work.
3. Open decision, ask the owner before picking one (same options as before, still don't block
   each other): B6-B12, A6, or NEW-3/5/7/8/9/10.
4. Same per-item workflow: reproduce → failing test with a synthetic fixture → fix → full suite
   green → commit named by finding id. Verify UI-observable changes in the running app before
   calling it done.
5. Do not push — branch is local-only, owner reviews before anything hits GitHub.
