# TidyTable — Fix the 2026-07-06 audit findings

You are working in the TidyTable repo (`~/Downloads/TidyTable`, branch `phase/5-charts`). It is a
browser-only React + Vite app that cleans and analyzes Excel files for spreadsheet novices
(often clinical data). House rules that shape every fix below:

- **Never guess, never silently drop or corrupt data.** When the app can't handle a value
  honestly, it must say so in plain English, not produce a wrong number.
- **Cross-validation is the product.** The in-app result, the Excel steps, and (where present)
  the R script must produce identical numbers. A fix to app logic must keep its Excel recipe in
  agreement, and vice versa.
- Plain, jargon-free UI copy. No new dependencies. All processing stays in the browser.
- Tests: Vitest (`npx vitest run`). Every fix below needs a regression test that fails before
  and passes after. 141 tests currently pass — keep them passing.

Work through the findings in order (P0 first). Each is independently shippable; commit per
finding or per group. All were reproduced against the actual modules on 2026-07-06.

> **Real-world dataset findings (2026-07-09):** two messy clinical spreadsheets were analyzed and
> mapped to these findings in `.claude/prompts/datasets-2026-07-09-realworld-examples.md`. The files
> themselves are **real PHI and are NOT in the repo** — build synthetic fixtures from the patterns
> that file lists. They motivate fixtures for P0-1/P0-2 (a real `.xlsx` column of durations stored
> as 1900-epoch dates + `"N Days"` text), P0-5 (constant columns), P1-8 (trailing-space category
> variants), and P1-12 (duplicate-ID reshape). Read that file alongside this one; **NEW-1 there
> refutes P0-1's assumption that `.xlsx` cells are safe true types, and NEW-2 flags a conflict with
> P0-2 — reconcile both.**

---

## P0-1 — `parseDates` silently corrupts non-US and invalid dates

`src/logic/checkup/normalizers.js` → `parseDates()` assumes the first number is the month with
no range check:

- `parseDates("25/03/2024")` → `"2024-25-03"` (month 25 — invalid, and it *looks* ISO so it
  passes the `findTextDates` detector and gets written into the user's cleaned data)
- `parseDates("13-05-2024")` → `"2024-13-05"`
- `parseDates("2/30/2024")` → `"2024-02-30"` (Feb 30 accepted)

This is silent data corruption in the flagship "fix your dates" feature, and it flows through
three surfaces: the checkup fix (`buildFixPlan.js`), recipe replay (`replay.js` uses the same
function), and the Excel recipe (`EXCEL_STEPS.parseDates` uses `DATEVALUE`, which is
locale-dependent and will disagree with the app on the same cells).

Fix:
1. Validate month 1–12, day 1–31, and real calendar validity (reject Feb 30) before rewriting.
2. Detect ambiguity **per column**, not per cell: if every parseable value in the column fits
   M/D/Y, use M/D/Y; if every value fits D/M/Y (any first number > 12), use D/M/Y; if the
   column is genuinely ambiguous (all values ≤ 12/12), do NOT silently pick — surface it the
   way `censoredValues` does (`needsPolicy`-style question: "Are these Month/Day or
   Day/Month?"). The scan finding in `scan.js` (`findTextDates`) is the right place to decide
   and pass the choice through `fix.params`.
3. Values that don't parse validly must be left unchanged (and ideally counted in the finding
   detail as "N could not be read").
4. Keep the recorded recipe step replayable: the chosen day/month order must be stored in the
   step params so replay never re-guesses.
5. Update `EXCEL_STEPS.parseDates` so the formula matches the chosen order (or state plainly in
   the instruction that Excel's DATEVALUE follows the computer's region setting and what to
   check).
6. Tests: corruption cases above; ambiguous column asks; unambiguous D/M/Y column converts
   correctly; replay uses the recorded order.

## P0-2 — Offline cohort engine counts non-numeric text as 0 in thresholds

`src/logic/offline/cohort.js` → `toNumber()` (and the duplicated copy inside the generated
transform in `src/logic/offline/fillPlan.js` → `buildTransformCode`):

```js
const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
```

`"N/A"`, `"pending"`, `"unknown"` all strip to `""`, and `Number("") === 0`, so a question like
"how many patients with duration under 7" **counts every N/A row as duration 0**. Verified:
`predicate({kind:"threshold", column:"Duration", op:"<", value:7})({Duration:"N/A"})` → `true`.
This is a silently wrong count from the engine whose whole pitch is "never a confident wrong
answer". Also note `"12-14"` → `Number("12-14")` is NaN (fine), but `"<5"` strips to `"5"` --> 5,
which double-counts censored values as their boundary without asking.

Fix:
1. In both copies (they must stay identical — consider generating the worker string from the
   same source like `buildFixPlan` does with `fn.toString()`): return `null` unless the value is
   already a number or a *clean* numeric string (allow `$`, `,`, whitespace, a single leading
   `<`/`>` should NOT be silently accepted — treat censored markers as non-numeric here).
2. Surface honesty: `executeCohort` should count how many rows in a threshold column were
   non-numeric and skipped, and `fillPlan.buildSummary` + `lookedFor` should say e.g. "12 rows
   had no readable number in "Duration" and were not counted." The COUNTIFS Excel step already
   ignores text, so after this fix app and Excel agree.
3. Tests: N/A rows not counted in `<` or `>=` thresholds; summary mentions skipped rows; the
   generated `transform_code` (run via `new Function`) agrees with `executeCohort` on a fixture
   containing N/A values.

## P0-3 — Haiku model option breaks every AI request (API 400)

`src/logic/claude.js`: `requestPlan` always sends `thinking: { type: "adaptive" }`, and the
`MODELS` list offers `claude-haiku-4-5`. Adaptive thinking is only supported on Claude 4.6+
models — on Haiku 4.5 the request is rejected with a 400, so choosing the advertised
"cheapest" option breaks every request with an unhelpful error.

Fix (pick one, simplest first):
- Send `thinking: { type: "adaptive" }` only for models that support it — e.g. a
  `SUPPORTS_ADAPTIVE` flag on each `MODELS` entry (`claude-opus-4-8`: yes, `claude-sonnet-5`:
  yes, `claude-haiku-4-5`: no — omit the `thinking` param entirely for Haiku; do NOT use
  `budget_tokens`).
- Or drop Haiku from `MODELS` if the plan-writing task is judged too hard for it anyway.

Note `max_tokens: 64000` is exactly Haiku 4.5's cap, so it's fine to keep. Add a test asserting
the request params built for each model in `MODELS` (extract a `buildRequestParams(model)`
helper so it's testable without network).

## P0-4 — Stats panel prints a false statement about expected counts

`src/logic/stats/runStats.js` → `contingencyResult`. The Fisher fallback only fires for 2×2
tables, but the default `choiceNote` claims "All expected counts are 5 or more (smallest is
X)" **even when X < 5** on an R×C table. Verified: a 3×2 table with `minExpected = 1.3` shows
"All expected counts are 5 or more (smallest is 1.3), so the chi-square test is reliable
here." A novice-facing stats tool asserting a falsehood about its own test choice is a
credibility-level bug.

Fix: three-way note —
- 2×2, min ≥ 5 → current chi-square note.
- 2×2, min < 5 → Fisher (already correct).
- R×C (not 2×2), min < 5 → keep chi-square but say honestly: "Some expected counts are below 5
  (smallest is X). With a table this size the chi-square p-value may be unreliable — consider
  combining sparse categories, and treat a borderline p with caution." Also set a flag the
  conclusion line can soften with.
Tests: each branch's note text; the false claim can no longer be produced.

## P0-5 — t-test renders "t = NaN, p-value = NaN" for constant groups

`src/logic/stats/ttest.js` + `runStats.js`. When both groups have zero variance (e.g. everyone
has the same value), `se = 0` → `t = NaN` or `±Infinity`, `df = NaN`, `p = NaN`, and the panel
shows literal NaNs. Also n=2 identical-value groups. Verified.

Fix: in `tTestResult`, before running the test, check `vA === 0 && vB === 0` (or `se === 0`):
- If the two means are equal: return the friendly `unsupported(...)` path — "Every value in
  both groups is identical, so there is no variation to test."
- If means differ but there is no spread: also refuse with a plain sentence ("both groups have
  no spread; a t-test cannot be computed — the difference is exactly X with no variability
  estimate") rather than fabricating a p.
Tests: both cases return `ok: false` with readable messages; no NaN reaches the steps array.

---

## P1-6 — Chart preview crashes or degrades on large data

`src/components/ChartPreview.jsx` uses `Math.max(...points.map(...))` — a spread of 200k+
elements throws `RangeError: Maximum call stack size exceeded` (verified). `buildDataset`
(`src/logic/charts/aggregate.js`) puts one scatter point per row with no cap, so a big sheet
crashes Step 9 in front of the user. Separately, a label column with thousands of distinct
values (e.g. patient ID) produces a thousands-of-bars chart.

Fix:
1. Replace all spread-max with a `reduce` loop (BarChart, LineChart, ScatterChart, and
   `ReportCardsView.jsx` line 7 uses spread over cards×bars too).
2. Cap scatter points (e.g. sample down to ~2,000 points and say "showing a sample of N of M
   points" under the chart).
3. In `recommendChart`/`ChartsPanel`, when a categorical dataset has more than ~30 groups,
   don't render a bar-per-category — return a "too many categories" recommendation telling the
   user to pick a column with fewer groups (count the distinct values honestly).
4. Tests: dataset with 300k rows builds and renders without throwing (logic-level test on the
   max computation + a DOM test with jsdom/happy-dom on a large dataset).

## P1-7 — Censored-values "Leave them as-is" produces contradictory outputs

`CheckupPanel.jsx` offers policy `"exclude"`; `censoredValues(v, "exclude")` is a no-op
(verified `"<0.5"` → `"<0.5"`), but:
- `EXCEL_STEPS.censoredValues` (`normalizers.js`) only handles `"missing"` and `"boundary"` —
  for `"exclude"` it emits the **boundary** formula, so the Excel recipe converts `<0.5` → 0.5
  while the app left the text alone. The two "must agree" outputs disagree.
- The no-op is still logged as an applied fix ("0 cells changed" at best).

Fix: for `"exclude"`, emit an Excel step that matches the app (an honest instruction: "leave
these cells exactly as they are; when you count or average this column, filter them out
first"), or drop the option from the fix path entirely and make "exclude" simply not add a fix
(with the finding remaining visible for awareness). Keep the recorded recipe consistent. Test:
plan built with each policy has matching app/Excel semantics.

## P1-8 — trimCase Excel recipe: broken VLOOKUP fallback + fragile Y/Z columns

`normalizers.js` → `EXCEL_STEPS.trimCase`:
1. The older-Excel fallback is `=IFERROR(VLOOKUP(C2,$Y$2:$Y$N,1,FALSE),C2)` — a one-column
   range with col index 1 returns the *old* spelling, i.e. a formula that does nothing
   (verified). It must be `VLOOKUP(C2,$Y$2:$Z$N,2,FALSE)`.
2. The lookup table is hardcoded to columns Y and Z, which can collide with real data on wide
   sheets and with the helper columns `buildFixPlan.buildExcelSteps` allocates after the data.
   Allocate the two lookup columns from the same `helperIndex` sequence instead.
Tests: generated formula string contains the 2-column range and index 2; lookup columns don't
overlap data or other helper columns for a 30-column sheet.

## P1-9 — Excel row references are wrong when the sheet has blank rows or padding

`src/logic/workbook.js` → `parseWorkbookFile` drops all-blank rows, and `sheet_to_json` starts
at the sheet's used range (which may not be row 1). Every Excel-step generator then computes
`lastRow = rows.length + 1` and tells the user "fill down to H{lastRow}" / builds COUNTIFS over
`X2:X{lastRow}` — against the user's *actual* file those ranges are short/shifted whenever the
physical sheet has interleaved blank rows, leading rows, or doesn't start at A1. The AI context
(`buildDataContext`) makes the same claim ("Data rows span row 2 to row N+1").

Fix: record honesty metadata at parse time: physical first data row, physical last row, and
`droppedBlankRows` count per sheet. Then:
- If `droppedBlankRows === 0` and data starts at row 2, keep current references.
- Otherwise extend ranges to the physical last row (COUNTIFS/helpers tolerate blank rows) and
  add one sentence to the first Excel step: "Your sheet has N blank rows inside the data; the
  ranges below go to row M to cover everything."
- Give `buildDataContext` the same numbers.
Tests: fixture workbook with blank rows in the middle → ranges cover the physical extent.

## P1-10 — Offline engine and Steps 7–10 silently use only the first sheet

`src/logic/offline/matcher.js` (`workbook?.sheets?.[0]`) and `App.jsx` (Stats, Regression,
Charts, Shelf-A all get `workbook.sheets[0]`). The checkup announces "Only the first sheet is
checked for now", but a user with the relevant data on sheet 2 who asks a question gets it
answered against sheet 1 (usually a decline, but a same-named value on sheet 1 can produce a
confidently wrong count).

Fix (minimum honest version, no big UI): add an active-sheet selector once at the top of the
post-upload flow (UploadPanel already has sheet tabs — lift the active sheet into App state)
and pass the selected sheet to checkup, matcher, stats, regression, charts, and Shelf's A-side;
`lookedFor` already names the sheet, keep that. Where that's too large a change, at least make
the matcher say in `lookedFor`/summary "answered from sheet "X"" and add the same "only the
first sheet" sentence to Steps 7–10 intros. Tests: matcher answers against the selected sheet.

## P1-11 — Web Worker sandbox claim is false (workers have network access)

`src/logic/runTransform.js` comments and UI copy say AI-generated code runs "in a Web Worker
(no DOM/network access there)". Workers have `fetch`, `XMLHttpRequest`, `WebSocket`, and
`importScripts` — generated (or pasted) transform code *could* exfiltrate the full dataset.

Fix: in `WORKER_SOURCE`, before executing user code, shadow the escape hatches:
`self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined;
self.importScripts = undefined; self.EventSource = undefined;` (assign `undefined`, and also
delete from the prototype where possible). Acknowledge in the comment that this is hardening,
not a security boundary. Ideally also add a CSP meta tag (`connect-src 'self'
https://api.anthropic.com`) in `index.html` — check it doesn't break the Anthropic SDK call or
Vite dev. Test: a transform that calls `fetch` fails with a clear error instead of succeeding.

## P1-12 — Shelf "one row per visit → one row per patient" silently discards collisions

`src/logic/offline/shelf.js` → `reshapeLongToWide` counts collisions (same patient + same
measure twice → later value overwrites earlier) but `ShelfPanel.jsx` wraps the result in
`single(r.rows)`, so the count is never shown — a silent overwrite in the app whose house rule
is "never silently drop". Also a measure name equal to the id column name overwrites the id.

Fix: show a notice-box when `collisions > 0` ("N values were overwritten because the same
patient had the same measure more than once — the last one won; check these before trusting
the table"), and prefix/rename colliding measure keys that equal `idCol`. Tests: collision
count surfaces; id column survives a measure literally named the same.

---

## P2 — smaller correctness and polish items

- **P2-13** `sentinelBlanks` Excel formula returns `""` (a text value), not a truly empty cell;
  `COUNTA` counts it, so the app's count and Excel's can differ. Change instruction wording
  ("Excel will treat these as blank for averages; COUNTA still counts the formula — use
  COUNTIF(...,"<>") instead if you need a count") or have users paste-special values then
  clear.
- **P2-14** Line-chart preview (`ChartPreview.jsx`) draws points in first-appearance order; the
  Excel step tells users to sort by date, but the preview itself can show a scrambled "trend".
  Sort time-like categorical datasets chronologically in `buildDataset` when
  `labelIsTime` (parse the labels; fall back to insertion order if unparseable).
- **P2-15** Pie preview with a single slice (100%) draws an invisible zero-length arc — draw a
  full circle when `frac === 1`. Negative values make pies/bars nonsense — when any value < 0,
  advisor should refuse pie and bar preview should render signed bars or refuse plainly.
- **P2-16** COUNTIFS criteria (`fillPlan.js` → `crit`) don't escape `*`, `?`, `~` — a cell
  value containing them is a wildcard in Excel but exact-matched in the app. Escape with `~`.
- **P2-17** Duplicate-header rename in `parseWorkbookFile` (`"Name"` twice → `"Name (2)"`) can
  collide with a real column already named `"Name (2)"` — one column silently overwrites the
  other. Keep incrementing until the name is free.
- **P2-18** `reportCards.js`: a person appearing under multiple groups keeps the first group but
  sums values from *all* groups — either split per group or state the rule in the card intro.
- **P2-19** `runViaClaude` in `App.jsx` funnels worker/transform errors through
  `friendlyApiError`, which mislabels them as API problems; show transform errors as-is.
- **P2-20** `saveRecipe` silently overwrites an existing recipe with the same name — confirm or
  auto-suffix.
- **P2-21** `estimateCostUSD` hardcodes Sonnet 5 at the $2/MTok intro price (ends 2026-08-31);
  note it or use $3.
- **P2-22** `StatsPanel` crosscheck step prints every raw value inline for the t-test — cap at
  ~50 values with "…and N more" (offer a copy button instead).
- **P2-23** API key is stored in plaintext `localStorage`. Acceptable for this architecture but
  say so in the ApiKeyPanel copy ("stored unencrypted in this browser's storage — anyone with
  access to this computer profile can read it; use a low-limit key").

---

## How to verify when done

1. `npx vitest run` — all existing + new tests green.
2. Manual sweep with a fixture workbook containing: European dates, `N/A` in a numeric column,
   a 3×2 category pair with sparse cells, a constant numeric column, blank rows mid-sheet, and
   200k rows (charts). Each of the P0s must now behave per its fix description.
3. Do NOT push or merge — leave the work on a branch off `phase/5-charts` for owner review
   (repo owner reviews everything before any push).
