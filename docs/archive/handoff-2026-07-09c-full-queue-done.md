# TidyTable — the full 2026-07-09 remaining-work queue is done

Branch: `fix/2026-07-09-audit-findings`, off `phase/5-charts`. **Not pushed** — all commits
local, owner reviews before anything hits GitHub. **384 tests passing (71 files)**, all green,
working tree clean.

This session worked through the entire "what's NOT done" list from
`handoff-2026-07-09-remaining-work.md` in order: P2-13..P2-23 (11 commits, done earlier — see
`handoff-2026-07-09b-p2-batch-done.md`), then **B6-B12, A6, and NEW-3/5/7/8/9/10** (12 more
commits, this pass).

## B6-B12 — the second UI/polish pass (all done)

1. **B6** — collapsible "What's in my data" per-column profile table in Step 1: letter, type,
   % filled, distinct count, min-max or top-3-by-frequency, flags empty/constant columns.
2. **B7** — in-app definitions editor (`DefinitionsEditor`/`DefinitionsPanel`,
   `logic/offline/definitionsStore.js`) replaces the Excel-round-trip for a `needs_definitions`
   block; merges on top of a real Definitions sheet (store wins on collision); export/import as
   JSON.
3. **B8** — reactive privacy badge (`logic/privacyBadge.js`) tracks actual sends to Claude this
   session, by mode; one-time confirm before switching to full-data mode.
4. **B9** — chart polish: numeric-only value dropdown, bars sort largest-first (time labels keep
   chronological sort from P2-14), real SVG title, PNG download button.
5. **B10** — `columnPickerOptions(sheet, role)` badges StatsPanel/RegressionWizard column
   pickers by type/cardinality and ranks likely candidates first.
6. **B11** — one-retry recovery path when a Claude-generated transform throws: "Try again — ask
   Claude to fix it" re-sends with the failure appended.
7. **B12** — ARIA tablist keyboard nav (`logic/a11y/tabsKeyboard.js`) for ResultsPanel/
   UploadPanel tabs; chart aria-labels now include a data summary; `aria-live="polite"` on
   status/notice boxes; `.dim` contrast checked (~5.05:1 / ~5.55:1, both pass WCAG AA).

## A6 — done

Category-merge canonical-spelling picker: `findCategoryVariants` now exposes each fold-group's
full spelling list with counts (`f.groups`); CheckupPanel renders clickable "Merge into: ..."
chips, defaulting to the most-common spelling until the user picks a different one.

## NEW-3/5/7/8/9/10 — done

- **NEW-3, NEW-9, NEW-10**: verified already-correct behavior with real-world-shaped regression
  tests — no code changes needed. `foldKey` already trims/collapses whitespace (incl. newlines)
  for category-variant merging (NEW-3) and Yes/YES casing (NEW-9); B6's profile already
  distinguishes near-duplicate column names by their real content (NEW-10).
- **NEW-5**: `buildColumnProfile` now recognizes a column that's really numeric but stored as
  text (one stray native float mixed in with hundreds of numeric strings) and relabels it
  "number (stored as text)" with a min-max summary instead of an unhelpful top-3 list;
  `columnPickerOptions` treats that label as numeric too.
- **NEW-7**: verified `parseDates`/`findTextDates` are anchored to a single date shape, so a
  multi-date cell (`"05/17/2026; 05/21/2026"`) is left untouched rather than truncated — no
  corruption. The "split multi-value column" capability itself stays out of scope (documented as
  its own future item in the source doc).
- **NEW-8**: `findMissing` no longer auto-blanks a sentinel token ("N/A") that's really a
  category value in a small closed text vocabulary (WBCs: `"</= 10"` / `"> 10"` / `"N/A"`) —
  only suppresses when the column's other values are non-numeric and few. `findCensored`'s regex
  now also recognizes `"</="`/`">/="` clinical shorthand, and a fully-censored column (no plain
  numbers, every value a threshold) can surface as censored.

## What's left

Nothing from the original queue. If more work surfaces, it'll come from a fresh audit or new
dataset findings, not this list.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout fix/2026-07-09-audit-findings`
2. `npx vitest run` — confirm **384 passing (71 files)**.
3. Do not push — branch is local-only, owner reviews before anything hits GitHub.
