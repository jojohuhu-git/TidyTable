# Plan: Smarter Offline Free Text (Steps 3 & 9) — 2026-07-10

**Goal:** A novice can type everyday questions into Step 3 (Describe what you want) and
Step 9 (Make a chart) and get an accurate, honestly-labeled answer offline — without an
API key — far more often than today. When the app must guess, it asks; when the user says
"no", it asks a *better* question instead of giving up; when AI does answer, the app
learns from it so the same question works offline next time.

**Grounding:** A 40-phrase novice audit was run 2026-07-10 against the real engine
(`runOffline` + `resolveChartRequest`) on the built-in example file. Findings drive the
phases below. Audit script preserved in spirit as the seed of the Phase 6 test bank.

**Owner decisions (2026-07-10):**
- Priorities: descriptive statistics with clinical reporting formats, everyday-word
  matching, most-common/top-N. Dates and missing-value questions deferred (revisit later).
- Guess style: confirm-chips, extended into an iterative refinement loop ("no" → smarter
  next question), never a silent guess.
- Sequencing: merge existing w1–w4 branches to main FIRST, then build this on a clean base.
- Done = a generalizing phrase test bank; successful in-app prompts and AI-answered
  prompts both feed the bank so the app gets smarter over time.

---

## Phase 0 — Land the base (prerequisite, no new features)

Merge the four unpushed local branches to main, in dependency order:
1. `revise/w1-download-fixed-file` (independent, 390 tests)
2. `revise/w2-smarter-matcher` (415 tests)
3. `revise/w3-results-routine` (stacked on w2, 430 tests)
4. `revise/w4-freetext-charts` (stacked on w2, 442 tests — may need rebase after w3 lands)

Push, PR, owner reviews, merge. All later phases branch from the new main.

## Phase 1 — Honesty bugs (fix regardless of everything else)

Three confirmed violations of the never-guess promise, found in the audits:

1. **"what's the average age" → confidently answers "Averaging \"Diagnosis\""**
   (`src/logic/offline/matcher.js`). Two defects in one:
   - Fuzzy column matching is too loose ("age" ⊂ "Diagnosis") — a loose fuzzy hit must go
     through the confirm-chip path, never straight to an answer.
   - Average/sum/median must refuse (or ask) on a non-numeric column. Add a numeric-type
     gate at plan-build time, with a plain message ("\"Diagnosis\" contains words, not
     numbers — I can't average it.").
2. **Step 9 "duration by diagnosis" silently draws a COUNT by Diagnosis**
   (`src/logic/charts/textToChart.js`). Leftover words that match a *numeric column name*
   should flip the read to "average of that column?" and confirm — not be dropped into a
   count that looks plausible and is wrong.

3. **Negation is silently inverted** (found 2026-07-10, second audit). "how many
   patients did NOT get amoxicillin", "never got amoxicillin", and "how many patients
   excluding UTI" all answer the OPPOSITE question — negation words are stop-words, so
   the engine counts patients who DID get the drug and reports it confidently.
   Fix by *supporting* negation, not just blocking it: detect not / never / no /
   without / didn't / excluding / other than → invert the condition (op "≠" /
   not-in; for per-patient grain, "never" = NO row matches). The answer line must
   state the negation back plainly ("Counting patients where \"Drug\" is NOT
   amoxicillin"). Any negation word the parser sees but cannot attach to a condition
   must block, never be dropped.

Tests: logic + DOM layer for all three, added to the Phase 6 bank as "must never regress".

## Phase 2 — Descriptive statistics with clinical reporting conventions

Extend the matcher + `fillPlan.js` beyond count/share/average/sum:

- **New computations:** median, quartiles (Q1/Q3 → IQR), standard deviation, min/max,
  range. Numeric columns only (Phase 1 gate).
- **Smart clinical output formats (the ask carries the format):**
  - frequency/count of a category → **n (%)** of the cohort
  - median → **median (IQR1–IQR3)**
  - mean/average → **mean (SD)**
  - duration-like columns → unit-aware display: pick days vs hours from column name
    hints ("_days", "_hours") and magnitude; always label the unit, never guess silently
    (if ambiguous, say the assumption in the answer line).
- **"Describe/summarize X"** → one descriptive panel: n, missing, mean (SD),
  median (IQR), min–max.
- **Anticipate & suggest:** after any stat answer, offer the standard companion as a
  one-click chip — asked for mean? offer "median (IQR) instead — better for skewed data";
  asked for a count? offer "as n (%)". Deterministic suggestions, no AI.

## Phase 3 — Everyday-word matching (biggest miss driver in the audit)

The matcher knows column *names*, not the words people use for them. "average duration
days" works; "how long were patients treated on average" declines. Fix in layers:

- **Word-form folding:** plural/singular, verb/noun forms ("prescribed"↔"prescription",
  "treated"↔"treatment") in `synonyms.js` / `valueMatch.js` token scoring.
- **Concept seed groups** (extend the clinical seeds W2 started): duration/length/how
  long/days of therapy; drug/antibiotic/medication/therapy/prescribed; diagnosis/
  condition/indication; patient/kid/child/case…
- **Learned aliases:** when a user confirms a chip ("treatment length" → Duration_days),
  save that alias locally (per file signature, like recipes match columns) so next time
  it's an exact hit. Storage next to `definitionsStore.js`.
- **Value-content hints:** a column whose *values* look like the asked-for words can be
  offered as a candidate ("antibiotics" → the column containing amoxicillin/cephalexin),
  via the existing value index — as a confirm-chip, never auto.

Comparator phrasing cleanup rides along: "treated for more than 7 days" currently blocks
because "treated" becomes ununderstood residue — recognized filler verbs near a matched
threshold should not block.

## Phase 4 — Most-common / top-N answer family

New intent family, pure sort-and-rank, fully offline:
- "most common diagnosis", "which drug was used most/least", "top 5 drugs",
  "longest duration" → ranked table output, each row as **value — n (%)**.
- Works with cohort filters ("most common drug for UTI patients").
- Step 9 mirror: "top 5 drugs" → bar chart sorted desc, capped at N.

## Phase 5 — The "no → better guess" refinement loop

Extends the W2d confirm-chip middle path (owner-requested):
- Every uncertain read keeps its full ranked candidate list, not just the top one.
- Chips show top 2–3 candidates + **"None of these"**.
- Clicking "None of these" eliminates the rejected candidates and asks a *discriminating*
  question built from what remains — e.g. "Is your question about the drug given, or the
  diagnosis?" (from remaining columns) or "Do you want a count of patients, or an average
  of a number?" (when the ambiguity is the operation, not the column).
- Each answer narrows the space; when one candidate remains, confirm it and (Phase 3)
  save the alias. When *zero* remain, decline honestly and offer AI — that boundary is
  where offline genuinely ends, because re-reading the sentence a brand-new way requires
  language understanding, not elimination.
- Log the whole exchange to the miss log so the owner sees which questions needed >1 round.

## Phase 6 — Self-teaching test bank + AI graduation

"Done" is measured here, and this is how the app keeps getting smarter:

- **Phrase test bank as templates, not literals:** a spec file
  (e.g. `test/phrase-bank.json`) of entries like
  `"<agg> <measure:duration> of therapy [for <cohort>]" → expected plan shape`,
  expanded into concrete phrasings at test time. One entry covers "average total duration
  of therapy", "median duration of therapy for UTI", "duration of therapy at discharge"
  once the slot vocabulary knows those words. Run in CI; target pass rate agreed with
  owner (suggest: ≥90% of bank answers or asks correctly, 0 confident-wrong).
- **In-app growth:** confirmed successes (user accepted the answer/chip) are saved
  locally as aliases + bank candidates; the existing `missLog.js` already captures
  failures — add a matching hit/alias store and an export so the owner can curate the
  best entries into the built-in seeds each release.
- **AI graduation:** when Claude answers a Step-3/Step-9 request, capture the *plan shape*
  it used (columns, filters, aggregation — never cell values, consistent with the
  `claudeHint` privacy stance) and store request→plan locally. Next similar request
  matches the stored template offline first. Over time the offline engine absorbs the
  AI's vocabulary for this owner's actual files.

## Phase 7 — Step 3 conversational & clinical extensions (2026-07-10 round 2)

Owner asked for further Step 3 ideas beyond the core phases. Verified against the
engine where marked; ordered roughly by value-per-effort.

- **Follow-up questions that remember the last answer.** Nested "of those" already
  works *inside one sentence* (verified: "how many had UTI and of those how many got
  cephalexin" answers correctly). Extend it across turns: after an answer, "of those,
  how many got cephalexin?" reuses the previous cohort as stage 1; "what about
  ceftriaxone?" re-runs the last question with one value swapped. This is the owner's
  "riff on a phrase" wish, live in the app. Deterministic — it's template reuse, not AI.
- **Typo tolerance for values.** "amoxicilin" blocks today (verified). Edit-distance
  1–2 against the value index → confirm chip ("Did you mean amoxicillin?"), never auto.
  Also covers Br/Am spellings (paediatric/pediatric) via the fold layer.
- **Number words and unit conversion in comparators.** "more than a week" → > 7 days
  (blocks today, verified); "two weeks", "48 hours" against a days column (convert and
  say so). Small fixed dictionary — week(s), day(s), hour(s), month(s)≈30d with the
  approximation stated in the answer line.
- **Compound questions answered as a set.** "average duration and most common drug by
  diagnosis" → split on "and" at the intent level, answer each part, present one
  combined result card. Reuses A2's clause machinery; each sub-answer is an existing
  plan type.
- **Table-1 builder (the clinical end-goal).** "summarize diagnosis, drug and duration"
  → one publication-style descriptive table: n (%) for each category value, median
  (IQR) / mean (SD) for numerics, missing counts per column. This is Phase 2's formats
  composed into the deliverable clinicians actually paste into papers. Offer it
  proactively when a request names 2+ columns with no operation.
- **Denominator + missing transparency on every answer.** Each n (%) states its
  denominator in words ("out of 5 patients; 1 row blank in \"Drug\", excluded").
  The novice's most common silent stats error, caught by default.
- **Grain memory.** The per-patient vs per-row question re-asks every time. Remember
  the choice per file signature + entity column (same matching recipes use); ask once,
  show a small "counting per patient — change" note afterwards.
- **"Show the rows behind this number."** Click any count → see the filtered rows that
  produced it. Trust-builder and error-catcher (a novice recognizes at a glance when
  the filter isn't what they meant); pairs with the Phase 5 loop as the final "no,
  that's wrong" escape hatch.
- **Teach-it form on decline.** When the engine declines and the user has no API key,
  offer a two-field mini-form ("this phrase means → column/values") that writes a
  definition/alias directly — the novice-friendly version of the Definitions sheet,
  feeding the same store as Phase 3's learned aliases.

## Phase 8 — Step 9 chart intelligence (after Step 3 is strong)

Owner direction: once Step 3 is sufficiently improved, chart design should be equally
smart with free text. The core architectural move makes everything else cheap:

- **One brain, two steps.** Today `textToChart.js` is a separate, smaller parser that
  borrows only low-level primitives. Rebuild it as: run the request through the SAME
  Step 3 pipeline (synonyms, learned aliases, refinement loop, phrase bank, negation,
  typo tolerance — all of it), take the resolved plan (cohort filter + group column +
  aggregation), and keep only chart-specific decisions local. Every future Step 3
  improvement then transfers to Step 9 for free, permanently.
- **"Chart this" chip on Step 3 answers.** Any breakdown, top-N, or descriptive answer
  offers one-click charting of the dataset it already computed — the novice never
  re-types the question in Step 9.
- **Chart-type inference from data shape, said out loud.** Categories → sorted bar;
  time-like x → line; "share/percent of" → 100% stacked bar (house style has no pies
  unless owner wants them); "spread/distribution of X" → histogram or box plot with
  median line. Always show one plain line — "Bar chart because Diagnosis is
  categories" — plus one-click alternates, mirroring the honesty stance.
- **Clinical presentation defaults.** Bars sorted descending, n (%) labels, top-N with
  an "Other (k)" bucket when categories overflow, median/IQR markers on distributions —
  the Phase 2 reporting conventions applied to pictures.
- **Post-draw tweaks in words.** A small deterministic verb set over the existing
  chart: "only top 5", "show as percentages", "sort alphabetically", "flip the axes",
  "hide the blanks". Each tweak re-renders and appends to the chart's recipe so replay
  keeps it.
- **Chart phrase bank + AI graduation.** Same Phase 6 machinery, chart-flavored
  template entries ("<agg> <measure> by <group> [for <cohort>]" → axes + type), same
  save-on-success and learn-from-AI loop.

## Deferred (owner chose not now)
- Date/time questions ("in March", "by month", "over time") — needs date parsing +
  bucketing; Visit_date is currently text-typed in the example file.
- Missing/blank-value questions ("how many are missing a lab value") — small, natural
  fit for a cleaning app; good first pick next round.

## Suggested build order & sizing
| Phase | Size | Ships alone? |
|---|---|---|
| 0 merge w1–w4 | review only | yes |
| 1 honesty bugs | S | yes — do first |
| 3 everyday words | M | yes — biggest miss reduction per effort |
| 2 descriptive stats | M–L | yes |
| 4 top-N | S–M | yes |
| 5 refinement loop | M | after 3 (needs candidate lists) |
| 6 test bank + graduation | M | bank seed early (with 1), graduation last |
| 7 conversational/clinical extensions | M–L | itemized — each bullet ships alone |
| 8 chart intelligence | M–L | after 3+5 ("one brain" needs the shared pipeline) |

Every phase: logic tests + DOM tests (both layers, per repo rule), phrase-bank entries
added, honest-decline behavior preserved.
