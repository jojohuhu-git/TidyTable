# How to ask TidyTable for things — a best-practices guide

*For the owner. Last verified against the code on 2026-07-17.*
*Agents: when you ship a change that alters what the app understands — especially
any item from `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` — update
the "Current limitations" section here in the same commit. This file is the
single most-current version of this guidance.*

## How the app decides (why phrasing matters)

TidyTable never guesses silently. When you type a request, it either:
- finds an **exact** match (your words matched a real column header or a known
  phrasing) and answers, or
- finds a **near** match and shows a "did you mean…?" chip — **clicking the chip
  is part of getting an accurate answer**, it's the app asking you to confirm, or
- **declines** in plain English when it can't do the thing honestly.

So the guide below is really about one thing: phrasing requests so you land in
the "exact" lane, and knowing what to do when you don't.

## The five golden rules (every step)

1. **Use the column's real header name whenever you know it.** "average
   Duration_days by Prescriber" beats "how long were patients treated by
   doctor". The app does understand everyday synonyms (drug / antibiotic / abx;
   duration / length / days of therapy; condition / indication) — but a synonym
   match is deliberately never treated as exact; it produces a confirm chip.
   Header names skip that round-trip.
2. **One question, one grouping.** "average duration by ward" — great.
   "average duration by ward and diagnosis" — do NOT use this today (see
   limitations below). Two *measures* sharing one grouping is fine: "average
   duration **and** most common drug by diagnosis" works.
3. **Prefer clicking over typing when a control exists.** Dropdowns (Labels,
   Value, Split by), example chips, and "Other options" can't be misread. Free
   text is the convenience path; the controls are the accuracy path.
4. **Read the answer's fine print.** Charts and results show `n=` counts,
   unreadable-cell counts, and honesty captions. A per-group average built on 2
   rows is not a finding; the n tells you.
5. **If the answer ignores part of your sentence, treat it as wrong.** The app
   is supposed to decline rather than drop words. If you named a column and the
   answer doesn't use it, stop and re-ask as two smaller questions (one known
   bug of this shape is listed below).

## Step 2 — Check your data for problems

Mostly tick-boxes: the scan lists findings, you tick what to fix. Phrasing
matters only in the small "describe a fix" box; keep it to one action on one
column ("trim spaces in Diagnosis").

**CSN and MRN columns are recognized by name** (CSN, PAT_ENC_CSN_ID,
"encounter id", MRN, "medical record number", "patient id") — the app no
longer needs the column to look statistically unique, so a visits export
where every patient has several rows still gets the right card:

- **Repeated encounter IDs (CSN)** are treated as a likely data error — each
  visit should appear once. Repeated rows that are *exact copies* can be
  removed with one tick (one of each is kept, and the removed rows stay
  viewable on the result card; Undo restores them). Repeated IDs whose rows
  *differ* are shown side by side for you to compare — the app never picks a
  winner; fix the right one in your file.
- **Repeated MRNs** are explained as often legitimate (one row per visit).
  Nothing is flagged as wrong. If you *want* one row per patient, tick the
  card and the app asks which row survives: earliest or most recent by a date
  column, or the most complete row. You instruct; it never decides.

Both fixes land in all three surfaces — the in-app result, the Excel steps
(a sort + Remove Duplicates recipe that keeps the same rows), and a real R
script that re-does the row removal on your original file so you can check
the row counts match.

**Dropdown-list check (automatic).** If a column in your .xlsx is filled from
an Excel dropdown (a data-validation list), the app reads that list straight
out of the file and flags any cell holding a value that is NOT on the list —
the typo scan only the list itself makes possible (pasted or imported values
bypass Excel's own dropdown check). Warn-only: the app never guesses which
legal entry you meant. Works for lists typed into the validation box, lists
pointing at a range of cells (even on another sheet), and named ranges.

## Step 3 — Describe what you want

*(Every example in this section was run against the engine on 2026-07-18 —
these are observed behaviors, not hopes.)*

### The sentence shape that works

> **[measure word] [column or value]** — plus, optionally:
> **"by [column]"** (one grouping) · **"of [group] patients," / "in [group]"**
> (a cohort filter) · **"over / under / at least [number]"** (a threshold).

The measure word does the heavy lifting. The ones the app knows:
- **Counting:** how many, number of, count of
- **Share:** what percent, what share, what proportion, what fraction
- **Numbers:** average (mean), total (sum), median, range, highest, lowest,
  standard deviation, interquartile range
- **Ranking:** most common, least common, top 5 (any number)
- **Variety:** how many different / unique
- **Overview:** summarize, describe

### Worked examples (all answer offline, no AI key)

- "How many rows have cefepime?" · "How many patients got cefepime?"
- "What percent of rows have UTI?"
- "Average Duration_days by Ward" · "count of rows per ward"
- "Most common Drug" · "Top 3 diagnoses" · "Least common Drug"
- "How many different prescribers?"
- "How many rows have Duration_days over 7?" · "…a duration between 5 and 10?"
- "Of patients with UTI, how many got cefepime?" (cohort first, then the ask)
- "Most common drug in ICU" · "average duration for ICU patients"
- "What percent of UTI patients got cefepime?"
- "How many patients did **not** get cefepime?" (negation is understood)
- "How many rows have cefepime **or** ceftriaxone?" (either-value counting)
- "How many rows are missing Visit_date?" (blanks are countable)
- "Show me all rows with UTI" · "list the rows with Duration_days over 7" ·
  "sort the rows by Duration_days" (seeing rows, not a number)
- "Average duration and most common drug by ward" (two measures, one "and",
  one grouping — both parts answered)
- "Summarize diagnosis, drug and duration" (a Table-1-style overview; note
  this exact "summarize A, B and C" shape is what triggers it)

### Middle-path asks — a chip, not an answer

When your word isn't a real column or cell value, the app shows a "did you
mean…?" chip instead of guessing. Clicking it is the intended flow, and the
choice is remembered for this file:
- "average **treatment length** by ward" → chip: the Duration_days column?
- "How many rows have **ceftriaxon**?" (typo) → chips with the closest real
  values.

### Phrasings that do NOT work — and what to say instead

| You typed | What happens | Say instead |
|---|---|---|
| "average Duration_days by Ward **and** Diagnosis" | Declines — one grouping column only (limitation 1) | Two separate asks, or Step 9's Split by |
| "list the rows **where** Duration_days **is** over 7" | Declines — "where … is" isn't parsed | "list the rows **with** Duration_days over 7" |
| "sorted by Duration_days, **longest first**" | Declines — the direction word reads as a ranking ask | "sort the rows by Duration_days" (or sort the result table yourself) |
| "how many rows **in January**?" / "average duration **by month**" / "**after 2026-01-06**" | Declines/asks — Step 3 can't filter or group by dates yet | Filter by date in Excel first, or ask the AI |
| "make a **table 1** by ward" | Declines — that wording isn't the trigger | "summarize diagnosis, drug and duration" |
| "**cefepime**" (a bare value, no question word) | Declines — no measure word | "How many rows have cefepime?" |
| "**Why** did durations increase?" / "Which drug is **best**?" | Declines — judgment questions aren't computable | Ask for the numbers behind your judgment |
| "**compare** ICU and Peds" | Declines — comparison with a p-value is Step 7's job | Step 7: grouping = Ward, outcome = your measure |
| "UTI durations for levofloxacin **ranked by** prescriber" | Declines — two filters + measure + group in one sentence (limitation 3) | Stage it: cohort ask first, then group |
| "average **Ward**" | Declines — words, not numbers | Name a numeric column ("average Duration_days") |

The pattern behind the failures: **one measure, at most one grouping, at most
one cohort** per sentence, and dates aren't understood yet. When the app
declines it always says why and never fakes an answer — a decline is it
keeping the "never guess" promise, not breaking.

**Dropdown terms are known words.** Every entry on a column's Excel dropdown
list counts as a word the app knows, even if no row currently contains it —
"How many rows have cUTI?" answers an honest 0 instead of "I don't know that
word". The same terms feed the "closest things" suggestion chips.

## Step 7 — Compare two groups (statistics)

Compares exactly **two columns at a time**: one value column, one grouping
column. The grouping column needs a handful of distinct values (Ward, Sex) —
not free text or an ID column. If your grouping has many values, this isn't the
tool; use a chart or Step 3 instead.

## Step 9 — Make a chart

Phrasings that work in the free-text box:
- "**X by Y**" for a two-column breakdown: "drug mix by diagnosis" →
  grouped/stacked bars with a legend.
- "**of <group> patients, …**" for a cohort filter, on a single-column chart
  ("of cystitis patients, top 5 drugs") or a two-column one ("of cystitis
  patients, drug mix by ward"). The title and caption will say the filter and
  the honest n either way.
- If a two-column request names something that isn't a real column, the app
  says exactly which part it didn't understand and offers 2-3 clickable
  alternatives — each already resolved, so clicking one never re-parses text.
- The **example chips** above the box are built from your own column names —
  including a cohort-filtered chip when a real value from a small category
  column makes a good filter demo.
- "**distribution of <numeric column>**" → histogram; box-and-dot appears under
  Other options for grouped numeric summaries.
- "**top 5 <things>**" / "least common <thing>" → capped ranked bars.
- **Small multiples (automatic):** when a hand-picked two-column chart has more
  than 12 categories *and* more subgroups than the 8-color legend holds, the
  app recommends a grid of mini charts (one panel per category, one shared
  scale) instead of one unreadable wall of bars. The full numbers table shows
  below the panels. If you typed a layout word ("stacked"), your choice wins
  and small multiples waits under Other options.
- **Tweak box** (after a chart is up): "only top 5", "sort alphabetically",
  "show percentages". Single-column charts only — it hides for two-column
  charts rather than pretending.

The dropdowns (Labels / Value / Split by) always reflect what your text
resolved to — glance at them to verify the app read you correctly. "Other
options" lists the sensible alternative layouts; the recommendation states its
reason.

**Build a surefire plan (shipped 2026-07-19, parked item 7).** For a request
too specific for one sentence to reliably parse — "UTI treatment durations
for levofloxacin ranked by prescriber" — open this collapsible panel under
Step 9 instead of typing it. Four slots, each editable by hand:
- **Rows kept** — add one or more `column = value` conditions (equality
  only); "+ Add condition (AND)" ANDs conditions within a group, "+ Add
  another group (OR)" ORs a whole second group in — e.g. `(Drug=cephalexin
  AND Diagnosis=cystitis) OR (Drug=amoxicillin AND Diagnosis=UTI)`. A live
  "N rows match" line updates as you build it.
- **Measure** — count, total, average, or **median** (new) of a numeric
  column.
- **Grouped by** — one or two columns. Two columns now supports a real
  measure too, not just a count — "average Duration_days by Ward and
  Diagnosis" is exactly the case this unlocks. A per-group n list shows
  before you run it, so a ranking built on a tiny group (n=1 or 2)
  announces itself rather than looking as solid as the rest.
- **Sorted** — becomes part of the plan itself (saved into the Excel and R
  output too), not a separate after-the-fact toggle.

A plain-English summary line above Run states exactly what will execute —
built only from real column names and real values, never invented wording.
Typing a request in the box above first pre-fills whatever the parser
confidently resolved (including every condition of a multi-condition cohort
the quick-chart box itself declines to auto-draw) — anything it isn't sure
of is left blank for you to fill by hand, never guessed. Running a plan
drives all three output surfaces: the in-app chart, the numbered Excel
steps (including the one-array-formula-per-group recipe for a median, since
Excel has no built-in median-per-group function), and a new "Check it in R"
script alongside them.

**Getting a chart out of the app** (below every chart):
- **Copy chart** puts it on the clipboard — paste straight into PowerPoint or
  Word. If your browser can't, the app says so and the downloads still work.
- **Download size** picks what the PNG is for: a slide, a poster (width you
  choose), or a journal figure (single/double column). The app warns if the
  chosen size would print the small text under ~8pt. The SVG download has no
  fixed size and stays sharp at any width.
- **Figure title / Footnote** boxes draw your own title and an "n = …" line on
  the chart itself, so every export carries them; the caption underneath is
  ready to copy into a manuscript figure legend.
- **Grayscale-safe colors** switches to one dark-to-light family for journals
  that print black-and-white.
- On result cards, **Copy table for Word** pastes as a real table (rows and
  columns), not a blob of text.

## Step 10 — Combine and reshape

Pick operations from the list (rows missing from another sheet, look up a value,
attach most recent earlier record, split paired list cells, switch between one
row per visit and one row per patient). Each operation reports what didn't line
up instead of guessing — read that report.

## Privacy and the AI mode (verified 2026-07-17)

- **Everything except the AI feature runs entirely in your browser.** The
  spreadsheet is never uploaded anywhere; the website only delivers the app's
  code. Using the cleaning, checkup, chart, and stats features on real data
  locally is technically equivalent to opening the file in Excel. (Whether an
  unapproved tool may touch PHI at all is your institution's policy — worth one
  email to compliance.)
- **AI "sample" mode (the default)** sends only column names, types, and
  fabricated look-alike values — never real cell contents.
- **AI "full" mode sends real rows to the Claude API. Never use it with
  identifiable patient data** — that is a disclosure to a third party with no
  BAA on a personal API key. De-identify first or stay in sample mode.
- **PHI mode (shipped 2026-07-18).** A tick-box next to the privacy choices in
  Step 1, for files holding real patient data. While on: the "whole
  spreadsheet" AI option is disabled (sample mode still works — it sends no
  real values), and the "results so far" list is no longer saved in browser
  storage — turning it on also wipes any results already saved there. The
  toggle itself is remembered, so it stays on across visits until you untick
  it. The session log and recipe still persist (they hold column names and
  counts, not rows).
- **Remaining caveat:** with PHI mode off, the "results so far" list survives
  a page refresh by being saved in the browser's local storage, unencrypted —
  and results can contain real rows. Fine on your own encrypted machine; tick
  PHI mode or clear the session on a shared one.

## Current limitations — and the workaround for each

*(Agents: keep this list in sync with the parked queue.)*

1. **"by A and B" (two grouping columns) in Step 3 can't be computed offline
   — but it no longer lies.** (Fixed 2026-07-18, parked item 4.) The app now
   declines plainly and offers the two one-column versions as clickable
   buttons; a general safety net also refuses any answer whose question names
   a column the answer didn't use. For a real two-way breakdown, use Step 9's
   Split by (counts) or the AI.
2. **Cohort + two-column chart in one sentence now keeps the cohort.** (Fixed
   2026-07-18, parked item 1.) "Of cystitis patients, drug mix by ward" scopes
   the crosstab to the cystitis rows — the title, caption, and n all reflect
   the filter. A two-column request that names a column that doesn't exist
   ("drug mix by prescriber" with no such column) now declines by name and
   offers 2-3 clickable, already-resolved alternatives instead of guessing or
   silently drawing the wrong thing.
3. **Three-part requests (two filters + a measure + a grouping) in one
   sentence.** (Fixed 2026-07-19, parked item 7.) "UTI treatment durations
   for levofloxacin ranked by prescriber" still won't parse as free text —
   but Step 9's "Build a surefire plan" panel now expresses exactly this:
   multiple AND/OR filter conditions, a measure (including median), one or
   two group columns, and a saved sort, all confirmed before running and
   reproduced in the chart, the Excel steps, and a new R script.
4. **Two-column charts always count rows.** (Fixed 2026-07-19, parked item
   7.) The plan-echo panel's "Grouped by" now supports a real average/total/
   median measure across two columns, not just a count — the panel also
   refuses to *stack* that measure (only grouped/side-by-side bars), since
   stacking an average or median across subgroups isn't a real number the
   way stacking counts is.
5. **Duplicate CSN/MRN cleanup now has action buttons.** (Fixed 2026-07-18,
   parked item 3.) Exact-copy encounter rows remove with one tick; repeated
   MRNs offer an optional keep-one-row-per-patient with your choice of
   surviving row. Repeated encounter IDs whose rows *differ* stay review-only
   by design — the app shows them side by side and you fix the file.
6. **Step 3 doesn't understand dates.** "In January", "by month", "after
   2026-01-06" all decline or ask for a definition (verified 2026-07-18).
   Workaround: filter to the date range in Excel first, or use the AI. (Date
   support was an explicitly deferred sub-item of the offline-smarts plan.)
