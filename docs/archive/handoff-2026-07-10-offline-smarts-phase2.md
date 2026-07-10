# Handoff — Offline-Smarts Plan: Phase 2 DONE (2026-07-10)

**Plan:** `.claude/prompts/plan-2026-07-10-offline-smarts.md`
**Builds on:** `docs/archive/handoff-2026-07-10-offline-smarts-phase1.md` (Phases 0–1)
and `docs/archive/handoff-2026-07-10-offline-smarts-phase3.md` (Phase 3).
**Next up (per the plan's order):** Phase 4 — most-common / top-N (Sonnet).

## What shipped (Phase 2 — descriptive statistics with clinical reporting conventions)

### New computations, fully offline
`median`, `quartiles` (Q1/Q3 → IQR), `stdev` (standard deviation), `min`, `max`,
`range`, plus the `describe`/`summarize` panel — new intents in `synonyms.js`,
routed through the same aggregation machinery average/sum already used
(`matcher.js` AGGREGATION_INTENTS → `matchAggregation`). All combine with cohort
filters ("median duration_days for patients with UTI") and group-by breakdowns
("median duration_days per diagnosis"), and all go through Phase 1's numeric
gate — "median Diagnosis" declines with the words-not-numbers message, verb
adjusted per stat (`runOffline.js` NON_NUMERIC_VERB).

The math lives in `cohort.js` `computeNumericStats()`:
- **Quartile method:** linear interpolation between closest ranks — the exact
  algorithm of Excel's `QUARTILE.INC` (= R/numpy default "type 7") — so the
  app's number and the Excel step's number always agree. Median is quantile(0.5)
  under the same method (matches Excel `MEDIAN` for odd and even counts).
- **SD is the SAMPLE statistic** (n−1, Excel `STDEV.S`), consistent across the
  JS math, the Excel instruction, and the inlined transform code. n=1 → SD is
  null and the answer says why ("fewer than 2 readable numbers"), never 0.
- `aggregateOne()` now returns the full stats bundle on every numeric intent,
  so the describe panel and any single stat are guaranteed mutually consistent.

### Clinical output formats (the ask carries the format)
`clinicalFormat.js` (new): `formatMeanSD`, `formatMedianIQR`, `formatNPercent`.
- mean → **"6 days (SD 2.94)"**; median → **"6 days (IQR 5–7.75)"** — unit named
  once on the headline value, clinical style.
- count → companion chip **"as n (%)"** → "3 (50%) of 6 rows".
- `units.js` (new): unit-aware duration display. A unit is used ONLY when the
  column name says it as a whole word (`_days`, `_hours`, `hrs`…, no
  "Holidays"/"Thursday" false hits). A duration-shaped column with no unit word
  ("Duration", "LOS") shows the bare number plus a stated assumption line
  ("its name doesn't say \"days\" or \"hours\"… rename to get a labeled unit")
  — never a silently guessed unit. Unrelated numerics (Age, Cost) untouched.

### "Describe/summarize X" panel
One result table per request (per group when asked): `n`, `Missing`,
`Mean (SD)`, `Median (IQR)`, `Min–Max` — with the plain-English gloss
"the typical range" in the summary for the non-coder owner.

### Anticipate & suggest (deterministic, no AI)
- Mean answer → chip "median (IQR) instead — better for skewed or outlier-heavy
  data"; median answer → the mirror chip. The companion is built by re-running
  the SAME `fillAggregationPlan` on the swapped intent, so its numbers equal
  asking directly; clicking records a normal result card AND a replayable
  routine step (the companion carries a real match).
- Count/share answer → chip "as n (%) — the way a paper reports it"; clicking
  reveals the formatted line in place (same numbers, no new computation).
- Chip renders in Step 4 above the results list; cleared on the next question
  or a new file. sum/min/max/distinct offer no companion (no standard pairing).

### Three-surface parity (summary / Excel steps / worker transform)
- Excel: `MINIFS`/`MAXIFS` used where they exist. **Excel has no MEDIANIFS/
  STDEVIFS/QUARTILEIFS** — filtered/grouped versions of those stats get the
  honest "filter first, copy the column, run MEDIAN / STDEV.S / QUARTILE.INC
  there" instruction instead of a fake formula. Unfiltered gets the direct
  formula (`=MEDIAN(range)`, `=MAX(range)-MIN(range)`, QUARTILE.INC steps).
- Transform: a shared ES5 `STATS_BLOCK` is inlined into the worker code,
  mirroring `computeNumericStats` line for line; the describe transform also
  inlines `formatMeanSD`/`formatMedianIQR` via `toString()` and a plan-time
  UNIT_SUFFIX constant so its Min–Max text is byte-for-byte the app's. Tests
  EXECUTE the generated code and compare to the app's result rows.
- Also fixed in passing: the old set-condition fallback used to say "to get a
  distinct count…" even for an average with a Definitions set — now worded per
  stat.

### Warm-up honesty fix (from the Phase 1 handoff list)
A chart group whose values were ALL unreadable ("N/A") used to draw as average
**0** — indistinguishable from a real zero. `charts/aggregate.js` now drops the
group from the plotted points and returns `noDataGroups`; ChartsPanel shows
"Not shown: cystitis — every value in that group was unreadable as a number…
Not the same as zero." Root cause was chart-local `num()` stripping non-digits
so `Number("")` read "N/A" as 0 — it now delegates to the offline engine's
`toNumber` (null for unreadable). Verified live on the example file.

## How missing/unreadable values are handled (decided + tested)
- A blank or non-numeric cell in the target column is **excluded from n** and
  tallied as `skipped`; the summary always says "(N rows had no readable number
  in … and were not counted)". The describe panel reports it as `Missing`
  (Excel step: `=ROWS(range)-COUNT(range)`).
- A group with ZERO readable numbers reports null / "no readable numbers"
  everywhere — value, SD, median — never a silent 0 (chart and table).

## Tests
Before: **510**. After: **587** (+77). Full suite green, `npm run build` clean.
- `phase2-stats-math.test.js` (10) — quantile/SD math vs Excel's documented
  algorithm; empty/single-value edges; unreadable-row exclusion.
- `phase2-matcher.test.js` (11) — intent routing, cohort/group-by combos,
  numeric gate on every new stat, honest declines, no bare "min"/"max" tokens.
- `phase2-fillplan.test.js` (28) — every stat end to end across the three
  surfaces, transforms executed; unit labeling incl. stated assumption;
  companion equality with direct asks; describe panel; runOffline e2e.
- `units.test.js` (13) + `clinicalFormat.test.js` (8) — the new modules.
- `phase2-descriptive-stats.dom.test.jsx` (6) — user-visible: clinical format
  in the summary, describe panel renders, both companion chips work by click,
  chip clears on the next question, text-column decline shows.
- `charts.test.js` +3 / `charts.dom.test.jsx` +1 — the noDataGroups fix.
- All honesty banks (Phase 1 + Phase 3) untouched and green.

## Judgment calls & deferrals
- **No bare "min"/"max" intent words** — "5 min" is a time unit in clinical
  text; only "minimum"/"lowest"/"smallest" (etc.) trigger the intent. False
  positives beat misses, per the standing rule. ("range" as an intent requires
  the word itself; "range of X" is safest phrasing.)
- **Unit inference is name-only** (never magnitude): the plan floated
  "magnitude" as a second signal for days-vs-hours, but a magnitude guess is
  exactly the silent assumption the app promises not to make. Implemented the
  unambiguous part (explicit name hints), stated assumption for the rest. No
  Opus escalation needed — nothing genuinely ambiguous remained once magnitude
  was ruled out on honesty grounds.
- **Unit conversion NOT done** ("2 weeks" → 14 days is Phase 7's number-words
  bullet, untouched).
- **Companion pairs are only mean↔median and count→n (%)** — the two the plan
  names. A quartiles↔median or range↔SD chip would be invented pairings.
- **Describe on a text column declines** (words have no mean); a frequency
  table for categorical columns is Phase 4's most-common/top-N territory.
- Summary line for grouped stats sorts by value (median for quartiles), same
  as the old average behavior; describe groups sort by n.

## State checkpoint
- Shipped as branch `phase/2-descriptive-stats` → merged to main → pushed.
  587 tests green at merge.
- Stale ancestor branches from the ORIGINAL build (`phase/0-ux-rails`,
  `phase/2-recipes`, `phase/3-matcher`, `phase/4-stats`, `phase/5-charts`) are
  all ancestors of main — an earlier naming generation, nothing unmerged;
  safe to delete whenever.
