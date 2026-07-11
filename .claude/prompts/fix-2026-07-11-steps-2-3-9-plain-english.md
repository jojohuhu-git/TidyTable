# Fix spec — make Steps 2, 3, 9 work from plain simple English (2026-07-11)

**Status: APPROVED 2026-07-11 — owner said "yes to all": decisions A–E all
approved as recommended, every P4 item green-lit, plus the P5 publication
workstream below. Execute with the fix-queue skill in the order given in
"Execution order" at the bottom.**

Owner's goal, in her words: make steps 2, 3, 9 easier to get high-quality,
accurate output from plain simple English requests. Step 2 is overwhelming and
its error descriptions should be simpler, plus she wants a plain-English box to
request cleaning. Step 3 often cannot generate results from typed requests, and
the "remember this" button appears to do nothing. Once Step 3 is optimized,
apply the same logic to Step 9 so charts smartly highlight data.

All findings below were reproduced live on 2026-07-11 against the dev server
(example data) and confirmed at the logic layer with node scripts. File
references are to the TidyTable repo.

---

## Diagnosis summary

The offline engine (src/logic/offline/) answers **counts, shares, averages,
medians, top-N** well. But novices phrase most requests as **"show me / list /
pull out the rows where…"** — a *row-listing* request the engine has no intent
for. Every such request falls into one of two bad endings:

1. The leading verb phrase ("show me all", "list all") is mistaken for an
   undefined **clinical term** and triggers the Definitions block with scary
   wording ("I will not guess clinical meaning") and nonsense "closest things"
   chips ("N/A" in "Duration_days").
2. It declines as `unrecognized`, and with no API key the **TeachItForm**
   ("Remember this and ask again") is shown — but teaching a word→column
   mapping can never fix an *unsupported operation* (sort, list, reshape), so
   the re-run declines again and the same form reappears. **This is why the
   button "does nothing."** The remembering itself works (verified:
   `tidytable_grain_choices` persisted; alias store keys by file signature).

## Verified reproductions (keep as test fixtures)

| # | Request typed | What happened | Root cause |
|---|---|---|---|
| R1 | "show me all patients who got cephalexin" | Blocked: `This question uses "show me all", which the data does not define… I will not guess clinical meaning` + chips `"N/A" in "Duration_days"` | Verb phrase eaten by missing-term detector (matcher.js) |
| R2 | "list all patients with UTI" | Same block on "list all" | Same |
| R3 | "sort the rows by visit date newest first" | Decline → TeachItForm → teach → decline again → same form. Infinite loop, looks like the button is dead | TeachItForm offered for un-teachable decline reasons (App.jsx runOfflineFlow decline branch) |
| R4 | "average duration for UTI" | Decline: "couldn't tell which column of numbers to average" — even though Duration_days exists and "who had the longest duration" resolves it fine | matcher target-column resolution fails when a cohort filter ("for UTI") is present alongside a fuzzy target word |
| R5 | "show me the rows where lab value is missing" | Decline unrecognized | No list-rows intent |
| R6 | Step 9: "diagnoses by number of patients" | "I couldn't tell which column to compare" | `valueMatch.js` scoreTokenMatch compares RAW tokens — `foldWord` imported but deliberately unused (line ~22 `void foldWord`), so plurals never match ("diagnoses"≠"Diagnosis", "drugs"≠"Drug") |
| R7 | Step 9: "compare drug use between diagnoses" | Resolved to "count of rows across Drug" marked **exact** — silently dropped "between diagnoses" | textToChart has no two-column (grouped) concept and doesn't flag the dropped phrase |
| R8 | Step 9: "trend of lab values over time" | "count of rows across Lab_value" (stretched) — nonsense; no time-trend path from free text | textToChart |

Working correctly today (don't regress): "how many patients got cephalexin"
(grain ask → 2 patients, choice remembered), "which drug was used most often",
"who had the longest duration", "how many got amoxicillin or cephalexin",
compound "and" questions, Step 9 "average duration by diagnosis".

---

## P0 — honesty/dead-end fixes (small, do first)

**P0-1. Stop treating request verbs as clinical terms.**
Strip leading request phrases ("show me", "show me all", "list", "list all",
"pull out", "give me", "display", "find") before missing-term detection in
matcher.js. R1/R2 must no longer produce the Definitions block.
Rewrite the block message to plain English while there: today's text
("I will not guess clinical meaning… add a row to a sheet named Definitions
with three columns…") assumes the user knows what a Definitions sheet is.
New shape: `I don't know what counts as "antibiotics" in your data. Tell me
below and I'll remember it.` — with the existing in-app form as the only path
mentioned (the Definitions-sheet route stays but moves to a "more" link).

**P0-2. Only offer the teach form when teaching can help.**
In App.jsx `runOfflineFlow` decline branch: show TeachItForm only for
word-resolution failures (`no-conditions`, unknown-term-shaped reasons). For
unsupported operations (sort/list/reformat/reshape), say plainly what the
offline engine can and cannot do, e.g. `I can count, average, and rank on this
computer, but I can't sort or pull out rows yet. Add an AI key (top right) for
that, or use the pickers in Steps 7–10.` No form that can't work.

**P0-3. Close the teach loop honestly.**
If a teach → re-run STILL declines, do not re-show the same form silently.
Show: `I saved what "X" means — that part worked. But the sentence still asks
for something I can't do offline (sorting).` The saved alias must be visible
(P2-1) so the user believes it.

**P0-4. Confirm every "remember" visibly.**
After any teach/alias/grain save, show a small confirmation line: `Learned:
"visit date" means the Visit_date column — saved for this file.` (The stores
already work; the user just can't see it.)

## P1 — capability gaps (the real fix for "cannot generate results")

**P1-1. New offline intent: list matching rows.** (DECISION A — recommended)
"show/list/pull out (the) rows/patients/everyone (with/where/who) <conditions>"
→ a filtered row table. Reuses the EXISTING condition/cohort parser and
fillPlan's row machinery (fillPlan already computes the matching rows for every
count — this intent returns them instead of counting them). Grain memory
applies (per-patient → one row per patient). Optional sort modifier: "newest
first", "sorted by X", "highest first" → an ORDER step on the result. Must
flow through all three outputs (result table, Excel recipe = FILTER/SORT
steps, R script = dplyr filter/arrange). R1/R3/R5 become answers.

**P1-2. Fix R4** (cohort + fuzzy aggregation target). "average duration for
UTI" must resolve Duration_days with the "for UTI" filter applied, or ask a
did-you-mean — never the current "couldn't tell which column" dead end.

**P1-3. Wire foldWord into valueMatch scoring** (fixes R6 and every plural
everywhere). Fold BOTH sides in scoreTokenMatch/findColumnCandidates. To keep
the never-guess promise: a match that only succeeds after folding is
`stretched` → confirm chip, not silent. Existing w2/phase3 tests must stay
green; the "prescriber vs prescription" trap stays separated (families table
already handles this).

**P1-4. Pooled multi-column ranking.** (Owner request 2026-07-11, from her
DC-antibiotics workflow. Design from her description only — the real file was
NOT read; build synthetic fixtures.)
Her sheets use data-validation dropdown columns: several related columns each
holding one term from a picklist (e.g. a "UTI" column and an "other cUTI"
column, each containing infection-type terms). She needs: pool the values of
two or more named columns into one tally and rank the terms — offline.
- New offline capability: the count/top-N family accepts MULTIPLE target
  columns. Phrasings: "most common values across UTI and other cUTI",
  "combine UTI and other cUTI and rank the types", "rank everything in X and
  Y together". Blank cells are skipped.
- Also add a no-typing path, since discoverability is the point: in Step 3's
  example area (and/or near the Step 9 pickers) a small "Combine columns and
  rank" control — pick 2+ columns from checkboxes, get the pooled ranked
  table. Same engine underneath.
- Counting policy needs the app's usual middle-path clarify, asked once and
  remembered like the grain choice: if one row has a term in BOTH columns
  (or the same patient appears on several rows), count it once per row, once
  per patient, or every occurrence? Default suggestion: occurrences for
  "values", patients when the grain memory says per-patient.
- All three outputs: result table (term, n, %), Excel recipe (helper
  stacked-range / COUNTIF over both ranges — must be reproducible by hand),
  R script (pivot_longer on the chosen columns + count). Chart follows via
  the one-brain path: "chart the UTI types across UTI and other cUTI" → bar.
- Works with the packed-cell splitter (Step 2) for multi-select validation
  cells: split first, then pool.

## P2 — Step 2 redesign (calmer, simpler, plain-English input)

**P2-1. One-line findings with progressive disclosure.**
Each finding renders as ONE line: checkbox + short title + count + `Fix` /
`Skip`. The current multi-sentence detail + sample chips move behind a
"what's this?" expander. Target: 5 findings ≈ 5 lines, not a page of text.

**P2-2. Split into two groups with plain headers.**
"Safe fixes — nothing is lost" (duplicates, N/A→blank, text→numbers, merge
spellings) vs "Needs your call" (date order, below-limit results). Add a
one-click "Tick all safe fixes" button. Wording of every title/detail passes
the read-aloud test for a non-coder (e.g. "Duplicate rows — 1 row is an exact
copy" stays; "epoch"/"1899-1900" style explanations get a simpler first
sentence with the technical bit in the expander).

**P2-4. Per-step "What this can do" panels — every step, one pattern.**
(Owner request 2026-07-11.) Step 3 already has the right idea ("What kinds of
questions work without AI" expander). Generalize it: every step card gets the
same small collapsed panel, "How to use this step", with exactly three parts:
1. **What it does** — one sentence.
2. **What it can't do (yet)** — the honest limits, e.g. Step 2: "checks the
   first sheet only"; Step 3: "can count, average, rank, and list — cannot
   reformat text or restructure the file"; Step 9: "one comparison per chart".
3. **Try these** — 2–3 clickable examples built from the USER'S OWN column
   names (extend examplePrompts.js, which already does this for Step 3, to
   Steps 2, 7, 9, 10). Clicking an example fills and runs it.
Keep each panel under ~8 lines expanded. The step intro paragraphs shrink to
one sentence each once the panel exists (this also serves the Step-2
"overwhelming" complaint). Any capability added later (e.g. P1-1, P1-4) MUST
update the relevant panel in the same commit — the panel is part of the
feature's surface area.

**P2-3. Plain-English cleaning box in Step 2.** (DECISION B — recommended)
A small input: "Or tell me what to clean…". A tiny intent matcher maps
requests onto the fixes the scan ALREADY found (each finding has a type +
column): "remove the duplicates" → tick duplicate fix; "fix the dates" → open
the date question; "turn N/A into blanks" → missing-values fix; "merge the
spellings of diagnosis" → variants fix for that column (column resolved with
the same folded matcher). Nothing new is computed — it only drives the
existing checkup, so it can't corrupt data. Unrecognized cleaning requests get
the honest Step-3-style message (and AI offer with a key).

## P3 — Step 9: same brain, then smart highlighting

**P3-1. Free of charge from P1:** list/sort intents + folded plurals transfer
through the Phase-8 "one brain" path (textToChart calls matchRequest first).
Re-test R6 after P1-3.

**P3-2. Honest handling of two-column chart requests (R7) — INTERIM.**
Until P6-1 ships, decline plainly — `That compares two things at once (Drug
and Diagnosis). I can chart one at a time for now; pick one, or use Step 7.`
The silent-drop-and-claim-"exact" behavior is the bug; the decline is the
stopgap. (Owner revised the original Decision C on 2026-07-11: two-variable
charts ARE wanted — they are built properly in P6, and this decline is
replaced by real support there. Do not skip the interim fix: R7's dishonest
chart must stop at P3 time, before P6 lands.)

**P3-3. Request-aware emphasis ("smartly highlight").**
- "highlight X" / a value named in the request → that bar in accent color,
  others muted grey, stated in the caption ("cephalexin highlighted, 3 of 6").
- Automatic callout of the largest/smallest category in the subtitle (already
  computed; just say it): "Most common: cephalexin (50%)".
- Average/threshold requests → dashed reference line with label.
- Value labels on bars by default ≤12 categories (n or n (%) matching the
  clinical convention already in clinicalFormat.js).
All emphasis must survive into the Excel-recipe text ("bold the cephalexin
bar…") and PNG download; aria summary (chartAriaSummary.js) must mention the
highlight.

## P4 — further improvements proposed by the review (each needs an owner yes/no)

**P4-1. Learned words must survive next month's file.** Aliases/graduations
are keyed by file "signature" = the exact sorted set of column names
(aliasStore.js fileSignature). Add or rename ONE column in next month's
export and every learned word silently stops applying — invisible breakage in
her core monthly-routine workflow. Fix: match per column, not per whole file
(an alias applies whenever its target column exists in the current sheet),
with the signature kept only as a tie-breaker. Same privacy properties.

**P4-2. Real date support → honest time-trend charts.** Visit-date columns
stay type "text" even after the Step 2 date fix, so "trend over time" has no
path (repro R8 drew a nonsense bar). After the date-format fix is applied,
type the column as a date; Step 9 then gains "by month/quarter" grouping and
the advisor's existing line-chart branch finally has something to bite on.
Stewardship data is time-based — she will hit this immediately.

**P4-3. Read Excel data-validation picklists as vocabularies.** Her columns
are built FROM validation dropdowns — the workbook itself already contains
the full list of legal terms per column (xl/worksheets/*.xml dataValidation
entries; SheetJS CE does not surface them, so this means parsing that XML
directly from the .xlsx zip). Imported lists give: known-term matching for
Step 3 ("cUTI" recognized even if no row currently contains it), better
"closest things" chips, and Step 2 flagging of cells that are NOT in their
column's picklist (a data-entry error scan no other finding catches).
Medium effort; genuinely differentiating for how she builds sheets.

**P4-4. Check every sheet in Step 2, not just the first.** Current honest
label "Only the first sheet is checked for now" becomes a per-sheet tab or a
combined findings list labeled by sheet. Her workbooks are multi-tab.

**P4-5. Committee-ready results export.** The cleaning log downloads as .txt;
results cards don't export as a document. One button: "Download a report
(Word)" — the result cards (question, answer, n (%), method sentence, chart
PNGs) in order, for stewardship-committee minutes. Client-side .docx.

**P4-6. Show the owner what the app couldn't answer.** missLog/hitStore
already record every miss and hit locally (Phase 6 bank fuel), but there is
no UI to see them. A small "Questions I couldn't answer this session" list
(with the honest reason) turns real usage into the teaching queue — she sees
exactly which phrasings to teach or request as features next.

## P6 — complex clinical graphics (owner request 2026-07-11: stacked data
and richer figure types; example — "of patients diagnosed with cystitis,
highlight the most common antibiotics prescribed or durations chosen")

Scope note first: the owner's cystitis example is TWO different asks.
(a) "Most common antibiotics among cystitis patients" = cohort filter +
ranked bar + top-bar emphasis — this is ALREADY covered by P1-3 (plural
matching), the existing single-value filter path, and P3-3 highlighting; add
it as an acceptance test there, not new machinery. (b) "The drug MIX within
each diagnosis" and "the durations chosen" need chart types that don't exist
yet — that is what P6 builds. Every new type ships across ALL surfaces at
once: aggregate.js dataset shape, advisor recommendation + plain-English
reason, ChartPreview SVG, palette rules, chartAriaSummary, chart title,
Excel chart recipe steps, ggplot2 code (P5-5), and all export paths (P5-1/2/4).
Load the dataviz skill before each item.

**P6-1. Grouped and stacked bars (two categorical columns).**
Crosstab dataset in aggregate.js (label column × subgroup column → counts).
Three layouts, advisor-chosen with the reason said out loud:
- **Grouped (clustered)** when the question compares subgroup sizes across
  categories.
- **Stacked** when the question is composition ("what makes up each bar").
- **100% stacked** when the request asks for shares/proportions ("mix",
  "breakdown", "share of") — y-axis in %, n= per bar in the caption.
Honesty guardrails: subgroups capped at the Okabe-Ito 8 (beyond that, keep
the top 7 + "Other" with the existing groupSmallIntoOther pattern, stated in
the caption); a legend is mandatory; per-patient vs per-row grain memory
applies. Free-text routes (extend chartPlanFromMatch + local parser):
"drug mix by diagnosis", "breakdown of Drug within each Diagnosis",
"Drug by Diagnosis stacked", "compare drug use between diagnoses" (R7 —
flips from the P3-2 interim decline to a real grouped chart). Two-column
pickers appear under "…or pick by hand" (label + split-by dropdowns).

**P6-2. Distribution charts for numeric columns.**
- **Histogram** for "durations chosen", "distribution of Duration_days":
  integer-friendly bins (small whole-number ranges bin at 1 unit — a
  duration histogram must show 5, 7, 10 days as their own bars, never
  "4.5–6.5"); bin rule stated in the caption.
- **Box + dot plot** for numeric-by-group ("duration by diagnosis" as
  spread, not just the mean): box for quartiles, jittered dots for the raw
  values when n per group ≤ ~50 (dots are what reviewers trust), medians
  labeled. The advisor OFFERS this as the alternative whenever an
  average-by-group bar is drawn ("Averages hide spread — see the spread
  instead"), and vice versa.
- Reuses the quartiles/median math already in the stats layer — one brain,
  no second implementation.

**P6-3. Pareto option for ranked bars.** For any "most common X" ranked bar,
a one-click "add cumulative % line" (bars sorted largest-first + a line
showing running share of total, right axis in %). This is the stewardship
staple for "which few drugs cover most use". Off by default; caption states
"top 3 of 9 drugs account for 78%". Excel recipe: helper cumulative column +
combo chart steps; ggplot: geom_col + geom_line/geom_point on a secondary
axis (or the honest twin-plot alternative if a second axis misleads).

**P6-4. Cohort-scoped charts get first-class wording.** "of cystitis
patients, …" / "among patients with cystitis, …" chart requests must carry
the cohort through: title says the cohort ("Antibiotics prescribed —
cystitis patients only"), caption says n and the filter, and the P3-3
highlight rules apply inside the cohort. Acceptance: the owner's example
sentence produces a ranked bar of Drug filtered to cystitis with the top
bar emphasized, and "durations chosen for cystitis" produces the P6-2
histogram filtered to cystitis.

**P6-5. Small multiples as the honesty escape hatch.** When a two-variable
request has too many categories for one readable stacked/grouped chart
(> ~12 labels × > 8 subgroups), the advisor recommends a grid of small
single-variable charts (one panel per category, shared axis) instead of
refusing or cramming. Panels cap at 12 with "…and N more" + the full table.

Deferred (say so in the per-step panel, don't pretend): heatmaps, slope/
dumbbell pre-post charts, survival curves. Revisit after P6 ships.

## P5 — publication-ready outputs (owner goal 2026-07-11: data and visuals
that move cleanly to a PowerPoint slide, manuscript, or conference poster)

Grounding (verified in code 2026-07-11): charts are hand-drawn SVG
(ChartPreview.jsx, ~480px wide viewBox) with the Okabe-Ito colorblind-safe
palette (palette.js) — a genuinely publication-appropriate base. But the ONLY
figure export is downloadChartPng.js at scale=2 (~960×600 px) — too small for
a poster (a 5-inch 300-dpi figure needs 1500 px) and unsized for slides.
Tables leave only as .xlsx/.csv (ResultsPanel.jsx). Dependencies today are
just react + xlsx + anthropic SDK.

**P5-1. Zero-dependency export wins first.**
- **Copy chart to clipboard** (ClipboardItem PNG) — paste straight into
  PowerPoint/Word. This alone covers most slide use.
- **Download SVG** (vector; serialize the existing element) — infinitely
  scalable for posters, opens in Illustrator/Inkscape/PowerPoint.
- **Copy table for Word** — copy result tables and Table 1 as text/html via
  the clipboard, so pasting into Word/PowerPoint keeps real table structure
  (not tab-separated text). Zero dependency; works today's browsers.

**P5-2. Purpose-sized figure export.** Replace the single PNG button with an
export chooser of three presets (plain labels, no DPI jargon shown —
explain in a "?" note): "Slide (PowerPoint)" → 1920×1080-fitting PNG;
"Poster" → 300-dpi at a chosen width in inches (default 8in → 2400px);
"Manuscript" → 300-dpi single-column (3.5in → 1050px) and double-column
(7in) options. Fonts scale with the export (SVG→canvas is vector, so this is
just the scale factor), and a minimum-legibility check warns when axis text
would land under ~8pt at the chosen size.

**P5-3. Figure furniture.** Editable title, axis labels with units, and a
footnote line ("n = 1240 encounters, Jan–Jun 2026") on the chart itself; a
caption box whose text is copyable for the manuscript figure legend. A
**grayscale-safe toggle** for journals that print B&W: switches the palette
to the single-hue ramp + direct bar labels (Okabe-Ito is not reliably
distinguishable in grayscale).

**P5-4. Office exports (needs two small MIT dependencies — owner approved
new deps 2026-07-11 as part of "yes to all"; keep them lazy-loaded so the
main bundle stays light).**
- **PowerPoint (.pptx)** via pptxgenjs: "Send to PowerPoint" on a chart →
  one 16:9 slide (title, figure, n= footnote); "Export all results" → a deck,
  one card per slide. Client-side only, nothing leaves the browser.
- **Word (.docx)** via the docx library — this is ALSO the vehicle for the
  already-approved P4-5 committee report. Tables use journal style: three
  horizontal rules, no vertical lines, n (%) / mean (SD) conventions straight
  from clinicalFormat.js. Covers Table 1 → manuscript directly.

**P5-5. ggplot2 figure code in the RStudio guide.** The R script already
reproduces the data; extend rscripts/ to also emit the matching ggplot2 chart
(same title, labels, Okabe-Ito colors) ending in
`ggsave("figure1.tiff", dpi = 300)` — journals that demand TIFF/EPS get it
through R, which the app cannot honestly produce in-browser. One brain rule:
the ggplot code must describe the same chart the preview draws.

**P5-6. Figure polish pass (with the dataviz skill).** One consistent font
stack, axis text ≥ 12pt-equivalent at slide size, thousands separators,
%-labels matching the clinical convention, consistent margins — applied to
preview and every export path so what you see is what you paste.

## DECISIONS — all resolved by the owner on 2026-07-11 ("yes to all")

- **A. APPROVED**: build P1-1 list-rows intent offline.
- **B. APPROVED**: Step-2 plain-English cleaning box (P2-3).
- **C. REVISED by owner 2026-07-11 (same day, later message)**: two-variable
  charts ARE in scope — stacked/grouped/100%-stacked bars, histograms,
  box+dot plots, Pareto and small multiples are the P6 workstream. The P3-2
  honest decline remains only as the interim state between P3 and P6.
- **D. APPROVED as recommended**: pooled ranking counts occurrences by
  default, with the one-time remembered clarify.
- **E. APPROVED**: all of P4-1 … P4-6, in the suggested order
  P4-1 → P4-2 → P4-6 → P4-4 → P4-3 → P4-5.
- **P5 workstream APPROVED**, including the two lazy-loaded MIT dependencies
  (pptxgenjs, docx) in P5-4.
- **P6 workstream APPROVED 2026-07-11** (owner: "showing stacked data is
  helpful too… think about more complex graphics like these").

No open decisions remain. If execution uncovers a new judgment call, ask the
owner — do not default.

## Execution order

1. **P0-1 … P0-4** — honesty/dead-end fixes (small; unblock everything).
2. **P1-1 → P1-2 → P1-3 → P1-4** — capability gaps, list-rows first.
3. **P2-1 → P2-2 → P2-4 → P2-3** — Step 2 calm-down, per-step panels, then
   the cleaning box (the box builds on the panels' example-chip pattern).
4. **P3-1 → P3-2 (interim decline) → P3-3** — Step 9 inherits Step 3, then
   smart highlighting. Acceptance here includes the owner's cystitis example
   part (a): "of cystitis patients, most common antibiotics" → filtered
   ranked bar, top bar highlighted.
5. **P6-1 → P6-2 → P6-4 → P6-3 → P6-5** — complex graphics: stacked/grouped
   first (flips the P3-2 decline to real support), then distributions, then
   cohort wording, Pareto, small multiples.
6. **P5-1 → P5-2 → P5-3 → P5-6** — publication exports, zero-dependency
   parts first (every P6 type must ride these export paths).
7. **P4-1 → P4-2 → P4-6 → P4-4** — robustness/visibility improvements.
8. **P5-4 (.docx first, which also delivers P4-5; then .pptx) → P5-5** —
   Office exports and ggplot figures (ggplot templates must cover the P6
   types: geom_col position=stack/fill/dodge, geom_histogram, geom_boxplot
   + geom_jitter).
9. **P4-3** — validation-list vocabularies (largest unknown, so last).

Rationale for the order: 1–5 change what the app can DO from plain English
and what it can draw (the owner's first goal, including stacked data); 6
makes the outputs presentable (second goal); 7–9 are durability and reach.
P6 lands before the export work so the new chart types are built once with
export in mind, not retrofitted. P4-5's Word report ships as part of P5-4 —
same dependency, same code path.

## Execution rules

Follow the fix-queue skill: one item at a time, failing test first (fixtures
above are the repros), full suite green (761+ tests at plan time — run and
quote the real number), live-verify in the browser, commit per item ID.
Surfaces rule: every Step-3 capability change must be verified in result
table + Excel recipe + R script, and after P3/P5, in the chart preview +
Excel chart steps + aria summary + each new export path. Load the dataviz
skill before any P3-3/P5 chart-styling work. PRIVACY: never read the owner's
real files (e.g. "Copy of DC antibiotics test file.xlsx") — synthetic
fixtures only; the owner declined file access on 2026-07-11. Do not push to
main without the owner's explicit go-ahead (TidyTable ship rule); commit
locally per item.
