# Handoff — Offline-Smarts Plan: Phase 4 DONE (2026-07-10)

**Plan:** `.claude/prompts/plan-2026-07-10-offline-smarts.md`
**Builds on:** `docs/archive/handoff-2026-07-10-offline-smarts-phase2.md` (Phase 2) and
`docs/archive/handoff-2026-07-10-offline-smarts-phase3.md` (Phase 3).
**Next up (per the plan's order):** Phase 5 — the "no → better guess" refinement loop.

## What shipped (Phase 4 — most-common / top-N ranking family)

A new intent family, fully offline, alongside the existing count/sum/average/
distinct/median/quartiles/stdev/min/max/range/describe family:

- **Frequency ranking** ("most common diagnosis", "least common drug",
  "which drug was used most/least", "top 5 drugs", bare "top N") — how often
  each value of a column appears, ranked most/least common first. Works on
  **any column type** (categorical or numeric — like a distinct count, this
  is exempt from the Phase 1 numeric gate; a numeric column's "most common
  value" is a legitimate mode read).
- **Magnitude ranking** ("longest duration_days", "shortest treatment_length")
  — the raw ROWS ranked by that column's value, largest/smallest first.
  Requires a **numeric column**; the Phase 1 honesty gate declines a text
  column exactly like average/sum do ("rank by the size of it").
- Both combine with a cohort filter ("most common drug for patients with
  UTI") — same `resolveConditions`/`buildConfirmation` machinery aggregation
  intents already use. A column reached by Phase 3's concept/value-content
  stretch (e.g. "longest treatment length" → Duration_days) is a confirm chip,
  never a silent guess.
- **Step 9 chart mirror**: the same wording (`detectTopN` in `synonyms.js`)
  caps the bar chart at N, sorted descending (or ascending for "least
  common"), reusing the exact tie-at-the-cutoff rule the Q&A table uses.

### New code
- `src/logic/offline/synonyms.js` — `detectTopN(text)`: a **separate**
  detector from `detectIntent`, not folded into the `INTENTS` phrase table.
  Every trigger is a specific multi-word phrase ("most common", "used most",
  "least frequent"…) or "top" + an explicit count (digit or a small
  one-ten number-word dictionary) — never a bare "most"/"least"/"top" token,
  so "at most 7 days" / "at least 5" (existing COMPARATORS phrases) are never
  misread as a ranking request. "longest"/"shortest" are unclaimed bare words
  (not overloading the existing `min`/`max` intents, which stay single-value
  reads).
- `src/logic/offline/cohort.js` — `rankFrequency`, `rankMagnitude`,
  `topNWithTies`, `executeTopN`. `topNWithTies(entries, n, keyFn, direction)`
  sorts and keeps the top `n`, but extends past `n` when the cutoff value
  repeats (a tie is always shown in full, never arbitrarily split) — `n` may
  be `Infinity` (no cap).
- `src/logic/offline/matcher.js` — `resolveTopNTarget` (locates the ranked
  column the same honesty-ordered way `resolveAggregationTarget` does),
  `matchTopN`, `describeLookedForTopN`. Checked **first** in `matchRequest`,
  ahead of every other intent (its wording never overlaps).
- `src/logic/offline/fillPlan.js` — `fillTopNPlan` and its summary/Excel/
  transform builders for both families.
- `src/logic/charts/aggregate.js` — `applyRankCap(dataset, {n, direction})`,
  the Step 9 mirror of `topNWithTies`.
- `src/logic/charts/textToChart.js` — `resolveChartRequest` now strips the
  ranking phrase before the label search and returns a `rank` field.
- `src/components/ChartsPanel.jsx` — wires `rank` through to `applyRankCap`
  and shows a tie-extension hint, mirroring the Q&A summary line.

### Excel steps (no fake formulas — Phase 2's precedent)
- **Frequency**: Excel has no "top N most common" formula. The honest
  instruction is a PivotTable (column in Rows, Count in Values, sort largest-
  to-smallest) plus one `COUNTIFS` step per ranked value as a hand-check —
  the same pattern the existing "per X" breakdown already used, just capped
  to the ranked set and with an upfront note.
- **Magnitude** *is* a native Excel operation — `Data > Sort` — plus
  `LARGE`/`SMALL` as a one-cell spot-check of the top value. This is the one
  branch of the whole aggregation family that gets a real formula where
  frequency cannot.

### Honesty details (per the plan's design notes)
- **Denominator stated**: frequency percentages are of rows with a *readable*
  value in the target column (blanks/unreadable excluded from both the
  ranking and the percentage base) — stated in the summary whenever it
  differs from the row total ("(N rows had a blank or unreadable … excluded
  … from the N used as the percentage base)").
- **Blanks never win**: a blank/unreadable cell is never added to the
  frequency map at all, so "least common" can never surface it.
- **Ties are deterministic and stated**: `topNWithTies` — a tie sitting at
  the N-th cutoff is always shown in full; the summary says so
  ("…extended to include a tie at the cutoff" / "…showing N because of a tie
  at the cutoff") whenever the shown count differs from what was asked for.

## Tests

Before: **587**. After: **621** (+34). Full suite green, `npm run build` clean.
- `src/logic/offline/phase4-topn.test.js` (20) — frequency + magnitude
  ranking end to end (summary/Excel/transform, transform code *executed* and
  compared to the app's own result rows, same convention as
  `phase2-fillplan.test.js`); cohort filters; ties; blank exclusion +
  denominator wording; the Phase 1 numeric gate on "longest"/"shortest"; the
  "distinct"-like frequency exemption on a numeric column; honest declines;
  never-a-bare-token false-positive guard against "at least"/"at most"; a
  concept-stretch confirm chip.
- `src/logic/charts/phase4-topn-charts.test.js` (9) — `resolveChartRequest`
  carries the `rank` field; `applyRankCap` caps/reorders/ties/no-ops
  correctly (categorical, time-series, xy, null-rank cases).
- `src/phase4-topn.dom.test.jsx` (3) — user-visible: "most common diagnosis"
  and "longest duration_days" render a ranked table offline; "longest
  diagnosis" still shows the words-not-numbers decline, no answer card.
- `src/components/phase4-topn-charts.dom.test.jsx` (2) — "top 2 drug" draws
  only 2 bars in the live `ChartsPanel`; re-picking a label column by hand
  clears the earlier cap.
- All Phase 1/2/3 honesty banks untouched and green.

**Also verified live** against the real dev server (not just tests): "most
common diagnosis" on the built-in example file correctly returns all three
diagnoses tied at n=2 each (33.3%), and "top 2 drug" in Step 9 draws exactly
2 bars (cephalexin 3, amoxicillin 2), excluding cefpodoxime, sorted
descending — confirmed by inspecting the live DOM/SVG output.

## Bug caught and fixed during this phase (worth flagging for future phases)

`rankFrequency`/`rankMagnitude` originally called the module-level `foldKey`/
`toNumber` **imports** directly. The established convention for the worker
transform is to inline a function's real source via `.toString()` (e.g.
`toNumber.toString()` elsewhere in `fillPlan.js`) — but under Vite's
SSR/test transform, an imported identifier inside a function gets rewritten
to a `__vite_ssr_import_N__.foldKey`-style reference at the *source* level,
and `.toString()` captures that already-rewritten text. Pasted into the
worker transform (which has no such binding), it throws
`ReferenceError: __vite_ssr_import_0__ is not defined`. This is caught
immediately by the existing "execute the generated transform code" test
convention — but only if a test actually calls `new Function(...)` on the
result, which is exactly why that convention exists. Fixed by hand-mirroring
`rankFrequency`/`rankMagnitude` as literal string blocks (`RANK_FREQUENCY_
BLOCK`/`RANK_MAGNITUDE_BLOCK`, same pattern as the existing `STATS_BLOCK`)
instead of `.toString()`-ing them. `topNWithTies` has no such reference and
*is* safely `.toString()`'d. **Lesson for future phases**: any NEW helper
function intended for `.toString()`-inlining must be checked for zero
references to module-level imports — if it references one, hand-mirror it
as a literal block instead, don't assume `.toString()` is safe just because
`toNumber` already uses it successfully elsewhere.

## Judgment calls & deferrals

- **Two disjoint trigger vocabularies, not one overloaded set.** The plan's
  phrasing suggested distinguishing frequency vs. magnitude "by column type"
  for the *same* wording; instead, the wording itself picks the family
  ("most common"/"top N"/"least common" → frequency, works on any column;
  "longest"/"shortest" → magnitude, numeric-gated). This avoids an ambiguous
  case (what should "top 5 duration_days" mean — 5 most-frequent duration
  values, or the 5 longest rows?) without inventing a rule nobody asked for.
  Documented here for Phase 5/6 in case the phrase-bank surfaces a real user
  phrasing that wants the other reading.
- **Asymmetric default N.** Frequency ranking defaults to **no cap** (the
  full ranked table) when no "top N" was stated — mirrors the existing
  "per X" breakdown, which always shows every group, and a clinical file
  usually has few distinct values. Magnitude ranking defaults to **top 1**
  — it ranges over raw ROWS (could be thousands), so "longest duration" with
  no count means "the single longest," not a full re-sort of the sheet.
- **Magnitude result rows are the full original row**, every column, not an
  invented "identifier" column — avoids guessing which column identifies a
  row (Phase 3's grain heuristic does something similar for a different
  purpose; reusing it here would have been scope creep). The plain-English
  summary shows a light-touch line naming the sheet's first column's value,
  stated as "(that column: value)", never claimed to be *the* identifier.
- **Number words**: only "one"–"ten" are recognized in "top N" ("top five" ==
  "top 5"), per the plan's "trivial with existing machinery" allowance.
  Larger/irregular number words remain Phase 7 territory, as the plan says.
- **Chart-side scope is deliberately narrower than Q&A.** Only the cap
  (`n`) and direction transfer to Step 9 — a full ranked TABLE isn't a chart
  concept. No new chart type was added; capping reuses the existing
  categorical bar path.
- **Chart-side label search has no plural→singular fallback** (unlike the
  Q&A matcher's `singularize`). "top 2 drugs" (plural) does not resolve to
  the `Drug` column on the chart side today — a pre-existing gap in
  `textToChart.js`'s `bestColumnSpan`, not a Phase 4 regression (confirmed:
  the exact same gap exists for non-ranking chart requests too, e.g. a bare
  "drugs by ward" would have the same issue). Worth a small standalone fix
  later; out of scope here since it's not part of the ranking family itself.
- **No companion chip added.** A frequency ranking's rows already ARE
  "value — n (%)" — the plan explicitly names this as a non-invented pairing
  that needs no companion (Phase 2's `average↔median`/`count→n(%)` pattern).
- **No Phase 6 phrase-bank file exists yet** (`test/phrase-bank.json` was not
  found in the repo) — Phase 4's phrasings were added as ordinary matcher
  tests in `phase4-topn.test.js`, per the plan's own fallback instruction.
  When Phase 6 builds the template/slot bank, these test cases are good seed
  material (they already cover the "false positives beat misses" guard, the
  numeric gate, the tie rule, and the denominator wording).

## State checkpoint

- Shipped as branch `phase/4-top-n` → merged to `main` (merge commit
  `merge Phase 4 offline-smarts: most-common/top-N ranking family`) → will be
  pushed (direct push allowed on TidyTable, per prior phases). 621 tests
  green at merge, `npm run build` clean.
- Next per the plan: **Phase 5 — the "no → better guess" refinement loop**
  (needs Phase 3's candidate lists, already preserved and ranked on every
  stretch — see Phase 3's handoff "Candidate lists preserved & ranked").
