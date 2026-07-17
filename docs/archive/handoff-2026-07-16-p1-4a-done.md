# TidyTable — Handoff after P1-4a (pooled multi-column ranking) done (2026-07-16)

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 3]` (this session's 2 commits, plus `3a2276f`
P1-3 which the prior session already committed but never pushed).

Baseline this session was **799 passing (132 files), 6 failing** (P1-4's
engine test, written red by the prior session) — confirmed to match before
any new work, per the `resume` skill. Now **813 passing (134 files)**, all
green, working tree clean at commit `4cf291e`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec being executed:
`.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md` (follow its
"Execution order" section). PRIVACY: never read the owner's real files —
synthetic fixtures only.

## What's done (by item ID) — 2 commits this session

1. **Docs carry-forward** — `5e1523e`. Committed the prior session's
   uncommitted P1-3 handoff + the superseded banner on the P1-1b/P1-2
   handoff (both were sitting on disk, untracked/modified, never landed).

2. **P1-4a** (pooled multi-column ranking, the typed capability) — `4cf291e`.
   A question like "most common value across Primary Dx and Secondary Dx" now
   answers instead of dead-ending. All 7 steps from the prior handoff's
   queue are done:
   - Engine (`src/logic/offline/cohort.js`): `rankFrequencyPooled` +
     `executePooledRank`, sibling to `rankFrequency`/`executeTopN`. Three
     counting policies (Decision D, owner-approved 2026-07-11, default
     `"occurrence"`): every occurrence, once per row, once per patient.
   - Matcher detection (`src/logic/offline/matcher.js`): recognizes "across X
     and Y", "combine X and Y and rank the types", "rank everything in X and
     Y together"; resolves 2+ column names reusing the existing
     `table1Columns`-style fragment resolver (comma/"and"/"&" split, EXACT or
     non-stretched concept hit only). Gates on the counting-policy question
     before ever returning `"confident"` — `status: "needs_pooled_policy"`
     if unanswered, never a silent default.
   - Counting-policy memory (`src/logic/offline/pooledPolicyStore.js`, new
     file): mirrors `grainStore.js` exactly — keyed by file signature + pool
     key (sorted column names), holds only the policy string + entity column
     name, never a cell value. Asked once per file + column pair, remembered
     after.
   - Outputs (`src/logic/offline/fillPlan.js`): result table (n/%), a real
     Excel recipe (COUNTIFS-sum per pooled column for the default occurrence
     policy; PivotTable + helper-column de-dup instructions for row/patient,
     since no single Excel formula does that de-dup), and a working R script
     (`tidyr::pivot_longer` + `dplyr::count`, with a `distinct()` step for
     row/patient policies). Worker transform code (`RANK_FREQUENCY_POOLED_BLOCK`)
     hand-mirrored like the existing `RANK_FREQUENCY_BLOCK`, for the same
     reason (closes over the `foldKey` import, breaks if `.toString()`'d
     directly into the worker).
   - UI (`src/App.jsx`): the counting-policy `ClarifyBox` question and the "as
     you chose earlier — Change" note, wired identically to the existing
     grain question/note pair (`answerPooledPolicy`/`changePooledPolicy`,
     `pooledPolicyChoices` memo, resets in `handleRun`/`handleWorkbook`).
   - Tests: `fix-2026-07-11-p1-4-pooled-rank.test.js` (engine, was already
     red, now green) + new `fix-2026-07-11-p1-4-pooled-matcher.test.js`
     (matcher detection, clarify gate, memory, fillPlan output, worker
     transform replay — 8 cases).
   - **Bug caught by live-verify, not by the test suite**: `summarizeAnswer()`
     in `fillPlan.js` had no branch for a pooled match and crashed on
     `exec.levels` (undefined) for every pooled answer. This aborted the
     whole "answer" flow silently — no console error, no UI feedback, the
     prompt just cleared and nothing appeared in Step 4. Found by actually
     driving the app (`npm run dev`, example data, "most common value across
     Diagnosis and Drug") — the suite was green throughout because nothing
     exercised `summarizeAnswer` with a pooled match until App.jsx called it.
     Fixed and reproduced clean afterward: clarify question → answer →
     remembered-policy note → result table / Excel / R all correct.

## What's NOT done — the remaining queue

- **P1-4b** (deferred, scope agreed 2026-07-11, not started): the no-typing
  "Combine columns and rank" checkbox control (Step 3 example area / Step 9
  pickers), and verification against the packed-cell splitter (Step 2) for
  multi-select validation cells.
- **P1-4a's chart branch** (deferred this session, was item 5 of the P1-4a
  queue): `textToChart.js`'s `chartPlanFromMatch` maps every match shape to
  `{ labelCol, valueCol, aggMode, filter, rank }` — ONE label column. A
  pooled chart needs the aggregation engine underneath (`aggregate.js`) to
  group by values pooled across SEVERAL source columns, which no existing
  chart path does. This is a materially different, riskier change than the
  Q&A-side work above and wasn't attempted rather than bolting on something
  untested. Scope it properly (probably: aggregate.js gets a
  `pooledLabelCols` mode) before starting. Load the `dataviz` skill first,
  per the general P3-3 note below.
- **P2-1 / P2-2 / P2-4 / P2-3** — Step 2 calm-down (one-line findings, safe/
  needs-your-call groups, per-step "How to use this step" panels, plain-
  English cleaning box).
- **P3-1 / P3-2 / P3-3** — Step 9 inherits Step 3, interim two-column
  decline, request-aware chart highlighting. Note: P3-1 says "re-test R6
  after P1-3" — that live-verify is STILL outstanding from two sessions ago
  (drive Step 9 with "diagnoses by number of patients" against the example
  workbook, confirm a Diagnosis-column confirm chip appears, accepting it
  draws the chart). Do this before or alongside P3-1.
- **P6-1 / P6-2 / P6-4 / P6-3 / P6-5** — complex graphics (stacked/grouped/
  100% bars, histogram + box/dot, cohort wording, Pareto, small multiples).
- **P5-1 / P5-2 / P5-3 / P5-6** then **P5-4 / P5-5** — publication exports.
- **P4-1 / P4-2 / P4-6 / P4-4** then **P4-3** — robustness/reach.

All decisions A–E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask them. Decision D (pooled-ranking counting policy) is
now also implemented, not just decided.

## Why this is a good stopping point

P1-4a is complete as one coherent, live-verified unit — engine, detection,
memory, all three output surfaces (table/Excel/R), and the UI clarify flow —
matching exactly what the prior handoff scoped it to be, deliberately
excluding P1-4b (a distinct UI-control surface) and the chart branch (a
distinct, harder engine change). Nothing here blocks P2/P3/P4/P5/P6, which
don't depend on pooled ranking.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **813 passing (134 files), all green**
   before any new work. If the counts differ, stop and diagnose.
3. Two independent threads are open — ask the owner which to pick, don't
   default:
   - Scope and build the P1-4a chart branch (needs an `aggregate.js` design
     decision first: how to represent "group by value pooled across N
     columns" alongside the existing single-`labelCol` shape).
   - Move on to P1-4b, or to P2 (Step 2 calm-down).
4. Whichever is picked, follow the per-item workflow: reproduce → failing
   test (synthetic fixture, never the owner's real data) → confirm red → fix
   minimally → full suite green → live-verify anything UI-observable (start
   the dev server via `preview_start` + `.claude/launch.json`, drive it in
   the browser — a green suite is not proof, as this session's
   `summarizeAnswer` bug shows) → commit named by item ID.
5. Push/deploy only on the owner's explicit say-so — including the 3 commits
   already sitting locally ahead of origin (`3a2276f`, `5e1523e`, `4cf291e`).
