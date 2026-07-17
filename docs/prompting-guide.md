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
column ("trim spaces in Diagnosis"). Repeated values in ID-like columns (CSN,
MRN) are currently **warn-only** — the app tells you but can't fix them yet;
handle duplicates in Excel or with Step 10's one-row-per-patient operation.

## Step 3 — Describe what you want

Words the app reliably understands:
- **Measures:** average, sum, count, most common, least common, top 5 (any
  number).
- **Grouping:** "by <column>" — one grouping column.
- **Two measures at once:** join with "and" — "average duration and most common
  drug by diagnosis".

Good asks: "average Duration_days by Ward" · "most common Drug" · "top 5
diagnoses" · "count of patients by Prescriber".

If parts of your request come back as chips ("did you mean the Duration_days
column?"), click to confirm — that's the app refusing to guess.

## Step 7 — Compare two groups (statistics)

Compares exactly **two columns at a time**: one value column, one grouping
column. The grouping column needs a handful of distinct values (Ward, Sex) —
not free text or an ID column. If your grouping has many values, this isn't the
tool; use a chart or Step 3 instead.

## Step 9 — Make a chart

Phrasings that work in the free-text box:
- "**X by Y**" for a two-column breakdown: "drug mix by diagnosis" →
  grouped/stacked bars with a legend.
- "**of <group> patients, …**" for a cohort filter on a *single-column* chart:
  "of cystitis patients, top 5 drugs". The title and caption will say the
  filter and the honest n.
- "**distribution of <numeric column>**" → histogram; box-and-dot appears under
  Other options for grouped numeric summaries.
- "**top 5 <things>**" / "least common <thing>" → capped ranked bars.
- **Tweak box** (after a chart is up): "only top 5", "sort alphabetically",
  "show percentages". Single-column charts only — it hides for two-column
  charts rather than pretending.

The dropdowns (Labels / Value / Split by) always reflect what your text
resolved to — glance at them to verify the app read you correctly. "Other
options" lists the sensible alternative layouts; the recommendation states its
reason.

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
- **One caveat:** the "results so far" list, session log, and recipe survive a
  page refresh by being saved in the browser's local storage, unencrypted.
  Results can contain real rows. Fine on your own encrypted machine; clear the
  session on a shared one. (A "PHI mode" switch that turns this off is a
  parked work item.)

## Current limitations — and the workaround for each

*(Agents: keep this list in sync with the parked queue.)*

1. **"by A and B" (two grouping columns) in Step 3 silently drops one column
   and still claims "exact."** Known bug (parked item 4), the one place the app
   currently breaks its own honesty promise. Until fixed: ask two single-column
   questions, or use Step 9's Split by for a two-way breakdown.
2. **Cohort + two-column chart in one sentence loses the cohort.** "Of cystitis
   patients, drug mix by ward" drops the filter (parked item 1). Workaround:
   type the *single-column* filtered request first ("of cystitis patients, most
   common drugs"), then hand-pick Split by = Ward — the filter carries through
   correctly on that path.
3. **Three-part requests (two filters + a measure + a grouping) aren't
   supported in one sentence** — e.g. "UTI treatment durations for
   levofloxacin ranked by prescriber". Do it in stages: filter in Step 3 or the
   cohort phrase, then group. A confirm-a-visible-plan builder for exactly this
   is a parked design item (item 7).
4. **Two-column charts always count rows** — no averages/totals across a
   Split-by yet.
5. **Duplicate CSN/MRN cleanup is warn-only in Step 2** (parked item 3); use
   Step 10's one-row-per-patient operation meanwhile.
