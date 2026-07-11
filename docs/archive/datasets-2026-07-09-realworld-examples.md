# TidyTable — Real-world messy datasets (2026-07-09)

Two real clinical spreadsheets were examined to stress-test the cleaning and analysis pipeline
against messiness the synthetic `patients.xlsx` fixture does not contain. Use their *patterns* to
make the app **more robust and more accurate**, and to seed regression fixtures.

> **PHI — do not commit or ship these files.** Neither source file meets HIPAA Safe Harbor
> de-identification: both contain full dates/timestamps, ages over 89, and encounter IDs (CSN), and
> the ED file also contains clinician real names. They are kept **outside the repo** (on the owner's
> machine only). Do **not** place them in `sample-data/`, commit them, or use them as the in-app
> "try example data" demo. Build every fixture below from **synthetic** rows that reproduce the
> defect pattern — no real dates, ages, IDs, or names in git.

- **ED-urine dataset** — ED urine testing, **1,512 rows × 51 columns**. Grain is one row per
  *encounter × organism*, not per patient.
- **DC-abx dataset** — discharge antibiotics, **411 rows × 37 columns**. Grain is one row per
  admission.

Column names below are structural (not identifying) and are safe to cite; all example *values* are
either synthetic or non-identifying data patterns. This file does **not** replace the two
2026-07-06 handoffs — it feeds them. Every item below is
tagged with the finding it reinforces (`→ fix-prompt P0-x` / `→ accuracy-ux Ax/Bx`) or marked
**NEW** where the current handoffs miss it. All specifics were verified by reading the actual
cells (openpyxl, `data_only=True`) on 2026-07-09.

House rules unchanged: never guess, never silently drop or corrupt; app / Excel / R outputs must
agree; plain jargon-free copy; browser-only; no new dependencies; Vitest test per change; **do
not push — owner reviews locally.**

---

## NEW-1 — A real `.xlsx` carries corrupted date/time types for a numeric column (highest value)

This is the most important finding, because it **refutes an explicit assumption in accuracy-ux
A1**: "Keep `cellDates: true` behavior for real `.xlsx` files (those cells carry true types)."
They do not always.

the DC-abx dataset → column **`Total Antibiotic Duration2`** is semantically an integer number
of days, but the stored cell types are a mix:

- 314 cells: `int` (e.g. `7`, `8`, `5`) — the intended form.
- **94 cells: `time(0, 0)`** — Excel serial `0`, i.e. a duration of **0** rendered as midnight.
- 1 cell: `datetime(1900, 1, 1)` — Excel serial `1` → duration **1**.
- 1 cell: `datetime(1900, 1, 7)` — Excel serial `7` → duration **7**.
- 1 stray `str`.

Someone typed durations, Excel auto-formatted the column as time/date, and the file now stores
true `date`/`time` typed cells. With `cellDates: true`, SheetJS surfaces these as `Date` objects,
so a duration column silently becomes dates — and A1's fix (trust real `.xlsx` types, only disable
inference for CSV) would **write `1900-01-07` into the cleaned "duration" column** and average a
column that is 23% JavaScript `Date` objects. Silent corruption in the flagship date feature, in
reverse.

Fix direction:
1. Add a check that runs on `.xlsx` columns too, not just CSV: if a column is *mostly* numeric
   but a minority of cells are `Date`/time-typed **and all those dates fall in the Excel epoch
   window (year 1900, i.e. serials 0–~60)**, treat them as **serial-number-formatted numbers**,
   not dates. Convert back: `time(0,0)` → `0`; a 1900-epoch `Date` → `serial = (date −
   1899-12-30)` in days. Surface it as a finding ("This column looks like numbers that Excel
   formatted as dates — convert N cells back to plain numbers?") — never auto-write the date form.
2. Confirm exactly how SheetJS surfaces these three cell shapes (Date vs number vs string) before
   coding — build a tiny synthetic `.xlsx` with a mixed int/`time(0,0)`/1900-epoch-date column,
   read it through `parseWorkbookFile`, and log the raw values. Amend A1's wording: `.xlsx` cells
   are *not* a safe true-type source; the checkup must still show its work on them.
3. Test fixture: a column of `{7, 5, time(0,0), 1900-01-07, 8}` → all read back as `{7,5,0,7,8}`;
   nothing rendered as a 1900 date; the finding counts the 3 converted cells.

## NEW-2 — Number-with-unit-suffix columns collide with the P0-2 non-numeric fix

Several duration columns store values like `"5 Days"`, `"365 Days"`, `"7 Days"` **mixed with bare
integers** in the same column:

- the DC-abx dataset → `D/C Antibiotic 1 Duration` (str `"4 Days"` … + int `3`),
  `DC Antibiotic Duration (confirmed)` (mostly int + one `"365 Days"`).
- the ED-urine dataset → `DC Antibiotic Duration 1/2/3` (all `"N Days"` strings).

This is a **direct tension with fix-prompt P0-2**. Today `toNumber("5 Days")` strips to `"5"` →
`5` (works by accident). After P0-2 tightens `toNumber` to reject non-clean numeric strings,
`"5 Days"` returns `null` and every duration would be **skipped from threshold counts** — turning
one silent error (P0-2's N/A-as-0) into a different silent error (legitimate durations dropped).

Fix direction: give the cleaner an explicit **"strip trailing unit" normalizer** (`"5 Days"` →
`5`, `"365 Days"` → `365`) offered as a checkup finding for columns where most values match
`^\s*\d+(\.\d+)?\s*[A-Za-z]+\s*$` with a consistent unit word. Run it *before* numeric coercion
so analysis sees `5`, not `null`. Keep P0-2's strictness for genuinely non-numeric text
(`"N/A"`, `"pending"`). Excel step: a helper column with `=VALUE(LEFT(...))` or
`=--SUBSTITUTE(A2," Days","")`. Test: a column `{"5 Days", 3, "365 Days", "N/A"}` coerces to
`{5, 3, 365, null}` and the threshold count skips only the `N/A`.

## NEW-3 — Whitespace-only and newline category variants (reinforces trimCase / A6)

the DC-abx dataset has real trailing-space duplicate categories that inflate distinct counts:

- `UTI`: `"ASB"` and `"ASB "` counted as two categories.
- `other cUTI`: `"stent"` vs `"stent "`.
- `Allx`: `"NKAA"` vs `"NKAA "` (and 14 cells with stray whitespace).

Plus **embedded newlines inside single cells** (a case the synthetic fixture lacks):

- `Urine resistance`: 24 cells contain `\n` (e.g. `"VRE\nBifidobacterium\nCandida glabrata"`).
- `Urine Organisms`, `comments…`: newline-containing cells too.

Use these as the fixture for `trimCase`/`findCategoryVariants` (→ fix-prompt **P1-8**, accuracy-ux
**A6**): trimming must collapse `"ASB "`→`"ASB"`, and the trim normalizer must also strip/normalize
internal newlines (or the app must at least not render a multi-line cell as a distinct category
silently). Test against these exact strings so the merge is demonstrated on real data.

## NEW-4 — Grain trap: one row per organism, `CSN` repeats (reinforces A2 + reshape/P1-12)

The ED-urine dataset is **1,512 rows but only 1,488 unique `CSN`** — 23 encounters span 2–3
rows, one per cultured organism (e.g. one encounter → *Pseudomonas aeruginosa* and *Proteus
mirabilis* on two rows with otherwise identical patient data).

Two consequences the handoffs should exercise against this file:
1. **Counting questions over-count.** "How many patients …" answered by raw row count is wrong by
   24. This is the concrete fixture for the grain question in accuracy-ux **A2/A3**: when a plausible
   ID column (`CSN`) has duplicates, the offline engine must either dedup or ask "count rows or
   count distinct CSN?" before answering a *patient* question.
2. **Reshape long→wide** (`shelf.js`, Step 10) has a perfect real input here: one row per
   `CSN`, organisms/antibiotic-sensitivities spread across columns. It also exercises the
   **collision path (fix-prompt P1-12)** — the same CSN with two organisms must surface the
   collision notice, not silently overwrite.

Test: a patient-count question against this sheet must not silently return 1,512; the reshape must
report the multi-organism collisions.

## NEW-5 — Numbers stored as text, with a stray real number mixed in (reinforces coerceNumbers)

The DC-abx dataset → `Admission SCr` and `Last SCr Prior to IV Abx`: **406 values are text
strings** (`"0.69"`, `"1.04"`) with exactly **1 real `float`** each. `coerceNumbers` must convert
the text and not be confused by the lone numeric type. Good fixture for the type-inference path in
`parseWorkbookFile` / `deriveSheet`, and for B6's per-column profile (should report this column as
"number stored as text"). Test: column parses to all numbers; profiler labels it numeric.

## NEW-6 — Empty columns and zero-variance (constant) columns (reinforces B6 / B10 / P0-5)

The DC-abx dataset contains:
- **Fully empty columns**: `Sputum Organisms` (0/411 filled), `CD4 T Cell Abs w/in 6 Months Prior`
  (0/411). The B6 profile table should flag "0% filled — empty column"; cleaning should offer to
  drop them; stats/chart/regression pickers (B10) must not offer them.
- **Constant (zero-variance) columns**: `GU Infection/CAUTI Indication` = all `"Yes"`,
  `Pulmonary/ENT Indication` = all `"No"`. These are the real fixture for the constant-group
  **t-test NaN guard (fix-prompt P0-5)** and for B10 (don't offer a single-value column as a
  grouping variable). Test: profiler marks both; picking a constant column for a t-test returns
  the friendly "no variation to test" message, not NaN.

## NEW-7 — Multi-value cells (`;` and newline delimited) — NEW cleaning capability

Many columns pack several values into one cell, which no current normalizer splits:
- ED-urine dataset: `ED Dx Codes` (1,182 cells with `;`), `ED IV Antibiotics`
  (`"Levofloxacin; Metronidazole"`), `Organism`, `0-14 / 15-30 Return Dates`
  (`"05/17/2026; 05/21/2026"` — **multi-date cells**), `Chief Complaints`.
- DC-abx dataset: `Blood Organisms`, `Urine Organisms` (`;` and `\n` delimited),
  `Symptoms`, `Allx`.

Two asks:
1. The date normalizer must **not corrupt multi-date cells** like `"05/17/2026; 05/21/2026"` — it
   should leave them unchanged (and ideally flag "this cell holds 2 dates") rather than parse the
   first and drop the rest, which would be a silent A1-class corruption.
2. Consider a **"split multi-value column"** finding (offer to explode on `;`/newline into
   one-value-per-row or into indicator columns) — a common, currently-unsupported clean for these
   files. Scope it as its own item; at minimum, don't let other normalizers mangle these cells.

Test: `"05/17/2026; 05/21/2026"` survives the date fix unchanged; a `;`-list column is detected as
multi-value.

## NEW-8 — Sentinel strings that are NOT missing (reinforces P2-13, inverts it)

The DC-abx dataset uses `"No Culture"` in `Blood/Sputum/Urine Culture` and the ED-urine dataset
uses `"N/A"` inside genuine 3-value sensitivity categories (`Sensitive / Resistant / N/A`, and
`WBCs` = `"</= 10" / "> 10" / "N/A"`). These are **real values meaning "not done / not tested,"
distinct from blank**. The cleaner must not blanket-convert `"No Culture"` or category-`"N/A"` to
empty (that would erase signal), and the censored/sentinel logic (fix-prompt **P2-13**, accuracy-ux
**A1**) should treat a value that co-occurs with a stable small category set as a *category*, not a
blank — or ask. `WBCs` also doubles as a **censored/threshold fixture** (`"> 10"`, `"</= 10"`)
for the censored-values path. Test: `"No Culture"` is preserved; `WBCs` `"> 10"` is flagged as a
censored/threshold value, not counted as the number 10.

## NEW-9 — Inconsistent boolean casing across columns (reinforces category normalization)

Within the ED-urine dataset, yes/no is spelled **both** `Yes/No` (`Admit`, `Cystitis Dx`,
`Positive Culture`) and `YES/NO` (`Urinary Device Present`, `0-14 Day ED Return`, `Pregnant`).
Category cleaning / profiling should recognize `Yes`≈`YES` when the user standardizes, and B6's
profile should not present them as different vocabularies per column. Minor but real; fold into the
trimCase/category-merge tests.

## NEW-10 — Redundant / near-duplicate columns (feeds B6 profiling)

The ED-urine dataset has `UA Authorizing Provide` (single-letter codes: `A`, `B`, `C`…, a
de-identification key) sitting right beside `UA Authorizing Provider` (clinician names) — a redundant,
easily-confused pair. The B6 "what's in my data" profile should make it obvious these are two
columns (letter count, sample values) so a novice doesn't group by the wrong one. No engine change;
presentation/profiling only.

---

## How to use these datasets (without their PHI)

- **The source files stay out of the repo.** They are real PHI (see the banner at the top). Do not
  commit them, do not use them as the B2 "try example data" demo. Everything below works from
  **synthetic** data.
- **Regression suite:** add one focused test per NEW item above by hand-authoring a small synthetic
  fixture (~10–15 rows) that reproduces the pattern — e.g. NEW-1 a mixed int/`time(0,0)`/1900-epoch
  column, NEW-2 `{"5 Days", 3, "365 Days", "N/A"}`, NEW-3 `{"ASB", "ASB ", "stent", "stent "}`,
  NEW-4 a repeated ID with two organism rows, NEW-6 an empty column and an all-`"Yes"` column. The
  value strings cited above are safe (synthetic or non-identifying) and copy-paste-able; do **not**
  copy real rows, dates, ages, or names from the source files. Each test should fail on today's code
  and pass after the corresponding fix.
- **Manual QA (owner, local only):** the owner can open the real files from outside the repo to
  eyeball behavior — confirm `Total Antibiotic Duration2` never shows a 1900 date, `"5 Days"`
  durations still count, `"ASB "` merges into `"ASB"`, empty/constant columns are flagged, and a
  patient-count question does not silently return the row count. Do not save any export of these
  files into the project.

## Priority (dataset-driven)

1. **NEW-1** (xlsx date-type corruption) and **NEW-2** (unit-suffix vs P0-2) — both are silent
   wrong numbers and both *interact with fixes already queued*, so resolve them together with
   P0-1/P0-2.
2. **NEW-4** (grain/CSN) and **NEW-6** (empty/constant) — accuracy of counts and stats.
3. **NEW-3, NEW-5, NEW-8, NEW-9** — reinforce existing normalizer work with real fixtures.
4. **NEW-7, NEW-10** — new capability (multi-value split) and profiling polish.
