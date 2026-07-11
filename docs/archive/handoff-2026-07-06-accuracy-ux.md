# TidyTable — Accuracy & UX handoff (2026-07-06)

## The goal this handoff serves

TidyTable's owner wants **an accurate, easy-to-use app for data cleaning, data analysis, and
easy-to-understand visuals, for an Excel novice analyzing complex and messy data sets.** This
document is the audit of the app against that goal: where accuracy quietly fails, and where the
experience is harder than a novice can handle. It is separate from
`.claude/prompts/fix-2026-07-06-audit-findings.md` (the confirmed-bug fix list) — read that
file too, do not duplicate its work here, and do its P0s first if they aren't already done.

> **Real-world dataset findings (2026-07-09):** two messy clinical spreadsheets (real PHI, **kept
> out of the repo** — build synthetic fixtures from their patterns) were analyzed and mapped to
> the findings here in `.claude/prompts/datasets-2026-07-09-realworld-examples.md`. They reinforce
> A1 (date corruption — including NEW-1, a real `.xlsx` that stores durations as 1900-epoch dates,
> which **contradicts A1's "trust real `.xlsx` types" note**), A2/A3 (grain: `CSN` repeats one row
> per organism, so patient counts over-count), A6 (trailing-space category variants like
> `"ASB "`/`"ASB"`), and B6/B10 (empty and constant columns). Read that file alongside this one.

Everything marked **[verified live]** below was reproduced on 2026-07-06 in the running app
(dev server, a deliberately messy CSV dropped in, fixes applied, questions asked) or by
executing the actual modules in Node. Repo: `~/Downloads/TidyTable`, branch `phase/5-charts`.
House rules: never guess, never silently drop or corrupt; app/Excel/R outputs must agree;
plain jargon-free copy; browser-only; no new dependencies; Vitest tests for every change;
**do not push — owner reviews everything locally.**

---

# Part A — Accuracy (silent wrong answers a novice cannot detect)

## A1. CSV parsing corrupts values before any feature sees them — P0 [verified live]

Dropping a CSV containing the lab value `<0.5` produced the value `"2000-05-01"` in the app's
data — SheetJS's CSV field inference (`XLSX.read` in `src/logic/workbook.js`) guessed it was a
date. Verified end to end: the workbook state held `WBC: [12.1, "2000-05-01", 9.4, "pending",
15]` and the censored-value detector then missed the `<0.5` entirely (it only flagged
"pending"). The same inference also silently decided `3/6/2024` means March 6 (US order) at
parse time — before the checkup's own date logic ever runs.

Consequences: corrupted values, a blinded checkup detector, and two *different* date-order
assumptions in one pipeline (SheetJS at parse, `parseDates` at fix — see fix-prompt P0-1).

Fix direction:
- For CSV/TSV input, parse with inference disabled (`raw: true` on `XLSX.read`, or parse the
  text yourself) so every cell arrives as the literal string, then let the existing
  checkup/normalizer layer do the interpretation — that layer shows its work and asks the user;
  SheetJS's silent guesses do neither. Numbers-as-text is fine: `coerceNumbers` exists for
  exactly that, and the type inference in `parseWorkbookFile` can coerce clean numerics itself.
- Keep `cellDates: true` behavior for real `.xlsx` files (those cells carry true types), but add
  a regression test that a CSV containing `<0.5`, `N/A`, `3/6/2024`, `1,204` round-trips with
  `<0.5` intact as a string.
- After the change, confirm the checkup now flags `<0.5` as a censored value on CSV uploads.

## A2. Compound questions silently lose conditions — P0 [verified live]

Asked in the UI: **"how many patients with UTI had duration_days over 7"**. The offline engine
answered **"Counting rows where "Diagnosis" is UTI — 3 of 5 rows (60%)"**. The
`duration_days over 7` condition was silently discarded (the whole post-cohort clause resolved
by a single-word value scan on "uti" and the rest of the words were thrown away). The trust
line technically discloses what ran, but the headline is a confident wrong answer to the
question asked — for the novice audience, small print is not honesty.

Where: `src/logic/offline/matcher.js` → `extractCohort` + `resolveCondition`. The cohort term
is everything after "patients with" up to a comma/"how many", so a one-sentence question packs
filter + threshold into one clause; `resolveCondition` returns the first thing that matches and
drops the residue.

Fix direction — refuse or split, never truncate:
1. After resolving a clause, check for **unconsumed significant residue**: if the clause
   contained a comparator + number (`detectComparator` + digit match) that the resolved
   condition did not use, or if ≥2 non-stop words remain unmatched, do NOT return the partial
   condition. Either try splitting the clause on the matched term and resolving the remainder
   as a second condition, or return a new `partial` status.
2. Give `partial` a plain UI treatment (like the grain question): "I understood *Diagnosis is
   UTI* but could not understand "had duration_days over 7". Answer just the part I understood,
   or rephrase as: 'of patients with UTI, how many had duration_days over 7'?" (that nested
   form already works — verified).
3. Tests: the exact sentence above must no longer return a 2-count; the nested form still
   works; a clean single-condition question still answers.

## A3. Aggregation words send novices on a wild-goose chase — P0-adjacent [verified live]

- "what is the **average** duration_days for patients with UTI" → blocked with: *"This question
  uses "what average duration", which the data does not define… Add a row to a sheet named
  "Definitions"…"*
- "how many patients **per diagnosis**" → *"This question uses "per diagnosis", which the data
  does not define…"*
- Even a sales question inherits clinical copy: "Give me total sales per region per month…" →
  *"…uses "give me total sales per region per month sorted from highest lowest"… I will not
  guess **clinical** meaning."*

Three distinct problems:
1. `INTENTS` in `synonyms.js` defines `sum` / `average` / `distinct`, and `GROUP_WORDS` defines
   "per/by/for each" — but `matcher.js`/`executeCohort` implement only count and proportion.
   The vocabulary is dead: detected, then mangled into fake "clinical terms."
2. The fallback for *any* unresolved phrase is "add it to a Definitions sheet" — the right
   answer for "oral beta-lactam", the wrong answer for "what average duration".
3. The block copy says "clinical meaning" regardless of domain.

Fix direction (pick one level, be explicit about which):
- **Level 1 (honesty only, small):** in `resolveCondition`/`runOffline`, when the unresolved
  words contain an aggregation intent (`average`, `total`, `sum`, `distinct`) or a group word
  (`per`, `by`, `for each`), return a *capability* message instead of a definitions request:
  "I can count rows and work out shares on this computer, but averages/totals/breakdowns per
  group need the AI mode. Add a key, or ask it as a count." Route these to the miss log with a
  distinct reason so the owner sees demand.
- **Level 2 (the real feature, strongly aligned with the "data analysis" goal):** implement
  offline `sum` / `average` / `distinct` over a resolved numeric column, and group-by for
  `GROUP_WORDS` ("how many patients per diagnosis" → one row per diagnosis with count and
  share). All the pieces exist: `detectIntent` finds the intent, `fuzzyColumn` finds the
  column, `executeCohort` already filters; add an aggregation step and per-group COUNTIFS /
  AVERAGEIFS Excel steps (the system prompt already teaches AVERAGEIFS). This single feature
  converts the most common novice analysis questions from "needs an AI key" to instant, free,
  private answers — the app's whole pitch.
- Either way: soften "clinical meaning" to "the meaning of these words" unless the term matched
  a clinical-looking pattern.
- Tests: each sample question above lands in its intended path with readable copy.

## A4. The four example prompts all fail without an API key [verified live]

Every example chip in `PromptPanel.jsx` was run through the offline engine: two decline to AI,
one blocks with the absurd definitions request quoted in A3, none answers offline. So the
app's own suggested first moves teach a keyless novice that the app doesn't work.

Fix: two labeled groups of examples — "Answered instantly on this computer" (e.g. "How many
patients with pneumonia?", "Of patients with UTI, how many had Duration_days over 7?", and
after A3-Level-2, "How many patients per diagnosis?") and "Needs the AI key" (the current
four). Disable/badge the AI ones when no key is set. Bonus: generate the offline examples from
the user's actual headers so they're clickable-and-working for *their* file.

## A5. The cleaning log reports corruption as success [verified live]

After applying the date fix on the test file, the log read "Standardized the dates in "Start
date" to YYYY-MM-DD (2 cells changed)" — and one of those cells is now `2024-25-03`. The log is
the user's defensibility trail; it must not vouch for an invalid value. After fix-prompt P0-1
lands, add a belt-and-braces invariant: any normalizer output claiming to be a date must be a
*valid calendar date* or the cell is left unchanged and counted as "could not be read" in the
log entry. Test: log entry for a column containing `25/03/2024` reports the unconverted count.

## A6. Let the user pick the surviving spelling in category merges

`findCategoryVariants` picks the most common raw spelling as canonical (ties → first seen; the
test file merged to lowercase "cephalexin"). A novice cleaning a report for a committee cares
that it says "Cephalexin". Small change: the finding already shows `"x" -> "y"` chips — make
the canonical clickable/choosable (default stays most-common), store the chosen map in
`fix.params.map` as today. No engine change needed; recipes already replay the recorded map.

---

# Part B — User experience for an Excel novice

## B1. The step wall: 9 cards at once, and "Step 1 → Step 6" when empty [verified live]

Before upload, the page shows "Step 1" followed immediately by "Step 6 — Replay on next
month's file" (Steps 2–5/7–10 are hidden) — it reads as broken numbering. After upload, all
ten sections render as one very long page; a novice with one question must scroll past
recipes, replay, regression, and reshape to find anything.

Fix direction (keep it simple, no router):
- Collapse Steps 5–10 into `<details>`-style cards (collapsed by default, one-line description
  visible) or group them under three plain headings that match user goals: **Clean it** (2),
  **Ask a question** (3–4), **Monthly routine** (5–6), **Analyze & chart** (7–9), **Reshape**
  (10).
- Only show Step 6 pre-upload under a heading like "Already have a saved recipe?" — not as
  "Step 6".
- Number steps dynamically or drop numbers for the optional sections.

## B2. No way to try the app without data

A novice landing on the page (especially with PHI they're nervous about) has no risk-free way
to learn the flow. Add **"Try it with example data"** next to the dropzone: load a built-in
synthetic messy workbook (reuse the fixture patterns from tests — text numbers, N/A, mixed
dates, duplicate rows, censored labs, two sheets so Step 10 works). This also gives every
future manual QA pass a one-click fixture. Label clearly that it's fake data.

## B3. Actions and results live far apart, and results overwrite each other [verified live]

Applying fixes in Step 2 (or asking in Step 3) puts the outcome in Step 4 with no navigation —
on a long page the user may not see anything happen. And each new action replaces
`plan`/`resultRows`, so the fix summary vanishes when a question is asked.

Fix: after any run, scroll Step 4 into view (`scrollIntoView({behavior:"smooth"})`) and flash
the card; label the result with what produced it ("Result of: your question '…'" / "Result of:
3 checkup fixes"). Keep a tiny session history above the result — a clickable list of this
session's runs (question or fix-batch → rows) that re-selects that result. Novices iterate;
losing the previous answer forces re-runs.

## B4. No undo and no "back to original"

Checkup fixes replace the working sheet; the only recovery is re-uploading. Keep the original
parsed workbook in state (`originalWorkbook`) and add two plain controls: "Undo last apply"
(restore previous sheet + drop the log event + recipe steps it added) and "Start over from the
uploaded file". This is the single biggest safety-net feature for a nervous novice. Note
`handleWorkbook` already resets everything on re-upload, so "start over" is nearly free.

## B5. A refresh wipes the entire session [verified live — HMR reload lost the workbook]

Everything lives in React state; an accidental refresh loses the workbook, applied fixes, log,
and unsaved recipe. Minimum: a `beforeunload` warning when a workbook is loaded. Better:
persist the session log + in-progress recipe to `localStorage` (they're small JSON; the
workbook itself can stay memory-only for privacy — the warning covers it).

## B6. No "what's in my data" overview

For "complex and messy data sets", orientation is step zero, and the state already holds
everything needed (`headers` with letter/type/samples, rows). Add a per-column profile table to
Step 1/2: column letter, name, type, % filled, distinct count, min–max (numeric) or top 3
values (text). One glance answers "which column is my outcome, which is broken" and feeds
better column picks in Steps 7–9. Render from existing data; no new computation over 500 rows
needed beyond what `deriveSheet` already samples.

## B7. The Definitions sheet is a heavy round-trip

Today a blocked term requires: open Excel → add a "Definitions" tab with the right columns →
save → re-upload → retype the question. That's the app's highest-friction moment, hit exactly
when a novice is already stuck. Add an in-app definitions editor: when `needs_definitions`
fires, show a small inline form (term · column dropdown · values-or-rule) that writes to a
definitions store kept alongside the workbook state (and offer export/import as JSON like
recipes, plus still honoring a real Definitions sheet). Re-run the question automatically after
the definition is added. Keep the never-guess rule: the user typed the meaning; the app still
spells it back in `lookedFor`.

## B8. The privacy badge can become false [code-verified]

The header permanently says "Your data has not left this computer", even after a full-mode
Claude request sends every cell value. Trust copy must be true: make the badge reactive —
default as-is; after any AI request, "Sent to Claude N time(s) this session (column names +
made-up samples)" or "(all values — full mode)" as appropriate. Also add a one-time confirm
when switching the radio to full mode ("this sends every value in the spreadsheet to
Anthropic using your key — OK?").

## B9. Charts: small changes with big novice payoff

(Beyond the P1 crash/cap fixes in the bug prompt.)
- **Value dropdown lists every column as "total X"** including text columns; the app then
  quietly counts instead. Filter to numeric columns (like `RecipePanel` already does) and label
  the fallback honestly.
- **Download the chart** — novices need to paste it into a doc/slide. Serialize the existing
  SVG → canvas → PNG download button (no dependency needed). Also set a real chart title
  ("count by Diagnosis") in the SVG so the exported image is self-explanatory.
- **Sort** time-like labels chronologically and bars largest-first in the preview (the Excel
  steps already tell the user to do both — the preview should model it).
- Add the value's axis/legend context: bar preview shows numbers but never says what they are;
  reuse `dataset.valueName`.

## B10. Stats & regression pickers offer every column, including IDs

`StatsPanel`/`RegressionWizard` dropdowns list all columns; a novice will pick "Patient ID" as
a grouping column and get a confusing "needs exactly two groups; it has 5" message (or a
5-level contingency attempt). Use the header type info to badge options ("text · 3 values",
"number") and put likely candidates first (few-distinct-value columns for grouping, numeric
for outcome). Same data as B6; presentation only. Also `crosscheck-ttest` prints every raw
value inline — cap with "…and N more" + a copy button (also noted as P2-22 in the bug prompt).

## B11. AI failure loop has no recovery path

If Claude's `transform_code` throws in the worker, the user sees one error line and a dead
end. Add "Try again" which re-sends the same request with the error appended ("The previous
transform failed with: … — return corrected code."). One retry, clearly labeled, then stop.
This converts the most frustrating AI failure into a usually-self-healing hiccup. (The
mislabeled `friendlyApiError` on worker errors is already P2-19 in the bug prompt.)

## B12. Accessibility quick pass

- Tab widgets (`role="tablist"` in ResultsPanel/UploadPanel) lack arrow-key navigation and
  `aria-controls`; add basic keyboard support.
- Charts are `role="img"` with generic labels — set `aria-label` to a one-sentence data summary
  ("Bar chart of count by Diagnosis: UTI 3, Pneumonia 2").
- The busy state disables buttons but nothing announces progress — add `aria-live="polite"` to
  the status line (`.status-line`) and notice/error boxes (error box already has
  `role="alert"`, good).
- Check color contrast of `.dim` text against the cream background once (styles.css tokens).

---

# What NOT to change

- The honesty architecture: `lookedFor` trust lines, refuse-don't-guess, surprises-not-silence
  in replay, the privacy rails (fake samples, excluded columns, key never leaving the browser),
  and the three-way cross-validation (app result + Excel steps + R script). Every fix above
  strengthens these; none may weaken them.
- The single-page no-backend design and zero-dependency chart/stats implementations.
- Plain-English copy style (short sentences, no jargon, explains *why*).

# Suggested order

1. **A1, A2** (silent corruption/wrong answers — do alongside the bug prompt's P0s).
2. **A3 Level 1 + A4 + A5** (honest messages, working examples — small, high trust payoff).
3. **B1–B5** (step wall, sample data, result visibility, undo, refresh guard — the core novice
   experience).
4. **A3 Level 2** (offline averages + group-by — the biggest capability win; sized like a small
   phase of its own, with Excel-step parity and tests).
5. **B6–B11**, then A6/B12 polish.

# Verification

- `npx vitest run` green throughout; add tests per item as specified.
- Manual script: drop a messy CSV containing `<0.5`, `N/A`, `3/6/2024`, `25/03/2024`, `1,204`,
  duplicate rows, and mixed-case categories → checkup must flag the censored value; dates must
  not corrupt; ask the compound UTI/duration question → no silent condition drop; ask an
  average and a per-group question keyless → honest capability message (Level 1) or a real
  answer (Level 2); click every example chip keyless → each does something sensible.
- Keep all work local on a branch; owner reviews before any push.
