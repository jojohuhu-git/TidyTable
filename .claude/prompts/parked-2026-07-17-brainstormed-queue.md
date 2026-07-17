# Parked items — consolidated, with brainstormed scope (2026-07-17)

**This file is the current, canonical list of parked/flagged items.** It replaces
the shorter flag lists scattered across the `docs/archive/handoff-2026-07-17-*`
files — those stay as history; update THIS file when an item ships or its scope
changes. The owner reviewed items 1, 3, and 4 with an agent on 2026-07-17 and the
brainstormed scope below reflects her direction. Nothing here is built yet.

**Owner's standing decision (unchanged):** P6-5 (small multiples) is the next
work item per the last handoff. The items below start only when the owner picks
one. Her tentative preference for ordering the parked work after that:
**item 4's small fix → item 3 → item 1 → the new plan-echo builder.**

Companion document: `docs/prompting-guide.md` — the owner-facing guide on how to
phrase requests. **Any session that ships one of these items must update that
guide's "Current limitations" section in the same commit.**

---

## 1. Crosstab cohort filter + example chips + partial-parse honesty

**Today:** `finishCrosstabPlan` in `src/logic/charts/textToChart.js` hardcodes
`filter: null`, so "of cystitis patients, drug mix by ward" silently loses the
cohort part. (A filtered crosstab CAN be reached by hand: type the filtered
single-column request, then hand-pick "Split by" — display side already works.)

**Brainstormed scope (owner-reviewed):**
- (a) Fix the real gap: free-text crosstab requests resolve "of [cohort] …"
  filters like single-column charts already do.
- (b) Partial-parse honesty: when a request only partially resolves, say which
  part wasn't understood and offer 2–3 clickable alternatives that fully work.
- (c) Data-aware example chips built from the user's actual column names, and —
  for cohort examples — sample values from low-cardinality category columns
  ONLY (never ID-like or free-text columns, which also keeps MRNs/names out of
  the UI). **Design rule (owner-agreed): a chip carries its already-resolved
  plan; clicking must never re-parse text.** The visible sentence is a caption.
- Known residual gap even after this: synonym mismatch when typing free-form
  (user says "prescriber", header says "ordering_provider") — chips help teach
  the real names; the alias machinery covers the rest; the plan-echo builder
  (item 7) is the long-term answer.
- Overlaps with parked item 5 (Step-2 example chips) — same chip pattern,
  different step; consider building the shared chip component once.

## 2. LineChart / BarChart axis-labeling flag

**Today:** `LineChart` in `ChartPreview.jsx` (~line 234) has no y-axis value
ticks and no axis titles (only x-axis category names), unlike `ScatterChart`
and the P6-2 histogram/box+dot which label both axes. A dormant `niceMax(0)→1`
quirk in `BarChart` (~line 119) would surface if tick labels are ever added
there. Flagged by the owner in the P6-2 session. Not scoped; no new brainstorm.

## 3. Step-2 duplicate CSN/MRN handling ("the explicit optional button") + PHI mode

**Today:** Step 2's checkup flags "Repeated values in the ID-like column X"
(`duplicateIds` in `src/logic/checkup/scan.js`) but the finding is
`fixable: false` — it warns and offers no action. "Explicit optional button"
means: put action buttons ON that warning card so the app can do the fix,
offered never automatic.

**Brainstormed scope (owner-reviewed 2026-07-17; this is her priority framing):**
- (a) Recognize real report ID columns BY NAME, not just by looks-unique
  statistics: **CSN / PAT_ENC_CSN_ID / encounter id → encounter ID; MRN /
  medical record number / patient id → patient ID.**
- (b) Duplicate encounter IDs → warn as a likely data error. One-click removal
  of exact-copy rows; side-by-side preview before acting when duplicate rows
  differ.
- (c) Duplicate MRNs → explain they are often legitimate (multiple visits);
  offer optional "keep one row per patient" with a choice of surviving row
  (first/last by a date column, or most complete). The owner instructs which
  duplicate situation to clear — the app never decides.
- (d) Never silently delete: removed rows stay inspectable/undoable. Must land
  in all three surfaces (in-app result, Excel recipe, R script).
- (e) **PHI mode switch** (owner asked after the HIPAA review): a toggle that
  disables the AI "full data" mode and stops persisting the results list to
  localStorage (`sessionPersistence.js`). Verified 2026-07-17: cleaning/charts
  are fully in-browser; AI "sample" mode sends only headers + fabricated
  values; AI "full" mode sends real rows (never HIPAA-safe with identifiable
  data on a personal API key); results-so-far persist unencrypted in browser
  storage. Full write-up in `docs/prompting-guide.md` § Privacy.
- Implementation note: Step 10 already has a "one row per visit vs one row per
  patient" reshape op (`ShelfPanel.jsx`) — reuse that machinery rather than
  re-implementing the collapse.

## 4. matcher.js silent-drop gap (small fix — do NOT grow it)

**Today:** "average duration_days by ward and diagnosis" routes through the
shared Step-3 pipeline (`src/logic/offline/matcher.js`), silently drops "ward",
and labels the answer "exact". Same bug class as R7 (fixed in
`textToChart.js`'s parser) in a different, untouched code path. This is the
only parked item that currently produces a wrong answer labeled exact —
suggested first among the parked work.

**Brainstormed scope (owner-approved direction):**
- (1) Two-column average/sum requests decline honestly with clickable
  single-column alternatives.
- (2) Generic guardrail for the whole bug class: after ANY free-text request
  resolves, if the user's sentence names a column the resolved plan doesn't
  use, the result can never be labeled "exact" — downgrade to warn/decline.
- Port R7's test cases to this pipeline; audit sibling phrasings (sum / count /
  median by two columns) for more instances before fixing.
- **Explicitly out of scope:** averaged crosstabs (supporting "average X by A
  and B" for real) — that's new engine scope; see item 7.

## 5. Step 2 StepHelpPanel example chips

Nine-plus sessions stale. The shared help panel (`StepHelpPanel.jsx`) supports
example chips; Step 2's panel has none. If item 1(c) builds the plan-carrying
chip pattern, this becomes a small follow-on using the same component.

## 6. P1-4a's chart branch (pooled ranking chart)

`chartPlanFromMatch` maps every match to ONE label column; a pooled chart needs
`aggregate.js` to group by values pooled across several source columns — a
materially different engine change. Deferred; previously recommended (not
approved) to bundle with P6. Unchanged, no new brainstorm.

## 7. NEW — Plan-echo builder (the "surefire accuracy" path)

**Why (owner's example):** "UTI treatment durations for levofloxacin ranked by
prescriber" = two ANDed filters (Diagnosis contains "UTI" AND Drug =
"levofloxacin") + measure (average Duration) + group (Prescriber) + sort. Free
text alone will never be surefire for this — parser coverage grows
combinatorially and each new pattern adds silent-failure surface (R7 and item 4
are both exactly that). The surefire mechanism is **never letting the parse be
invisible**: translate the sentence into a visible, editable plan the owner
confirms before it runs.

**Brainstormed scope (owner-reviewed; big item — scoping pass + design proposal
for approval BEFORE building):**
- Four editable slots: Rows kept (multiple ANDed conditions), Measure, Grouped
  by, Sorted — each a dropdown of real columns/values.
- Show matching-row count and per-group n before running (a ranking built on
  n=2 must announce itself).
- Free text pre-fills the form; the confirmed form is what executes, in all
  output surfaces.
- This, not more parser patterns, is the intended long-term answer to
  multi-column requests; item 4's guardrail stays as the safety net regardless.

## Also still queued from the spec (unchanged, not "parked")

P6-5 (next), P5-1→P5-6 publication exports, P5-4 (.docx/.pptx), P5-5 (ggplot2
figure code — must cover crosstab, distribution, Pareto, and small-multiples
types when it lands), P4-3 (validation-list vocabularies, last per spec).

---

## Paste-ready prompts

Each assumes: `~/Downloads/TidyTable`, per-item workflow (failing test first,
synthetic fixtures only, full suite green, live-verify), commit locally, never
push without the owner's go-ahead. Update `docs/prompting-guide.md` and THIS
file in the shipping commit.

**Item 1:**
> In ~/Downloads/TidyTable, build item 1 of .claude/prompts/parked-2026-07-17-brainstormed-queue.md (crosstab cohort filter + example chips + partial-parse honesty). (a) Fix finishCrosstabPlan in src/logic/charts/textToChart.js so "of [cohort] …" free-text crosstab requests resolve the filter instead of hardcoding filter: null. (b) When a request partially resolves, say which part wasn't understood and offer 2–3 clickable alternatives. (c) Add data-aware example chips from my actual columns; cohort examples may use sample values from low-cardinality category columns only — never ID-like or free-text columns. Design rule: each chip carries its already-resolved plan; clicking never re-parses text. Update docs/prompting-guide.md limitations and the parked-queue file in the same commit.

**Item 3:**
> In ~/Downloads/TidyTable, build item 3 of .claude/prompts/parked-2026-07-17-brainstormed-queue.md (Step-2 duplicate CSN/MRN handling + PHI mode). Follow the (a)–(e) scope in that file: name-based CSN/MRN recognition; encounter-duplicate removal with preview; optional keep-one-row-per-patient with surviving-row choice; never silent, always undoable, all three surfaces; PHI-mode toggle disabling AI full mode and results persistence. Reuse Step 10's one-row-per-patient reshape machinery. Update docs/prompting-guide.md (limitations + privacy) and the parked-queue file in the same commit.

**Item 4:**
> In ~/Downloads/TidyTable, fix item 4 of .claude/prompts/parked-2026-07-17-brainstormed-queue.md (matcher.js silent-drop). (1) Two-column average/sum free-text requests decline honestly with clickable single-column alternatives instead of dropping a column. (2) Generic guardrail: if the request names a column the resolved plan doesn't use, the result can never be labeled "exact". Port R7's test cases to this pipeline and audit sum/count/median two-column phrasings. No averaged crosstabs — separate item. Update docs/prompting-guide.md limitations and the parked-queue file in the same commit.

**Item 7:**
> In ~/Downloads/TidyTable, run a scoping pass for item 7 of .claude/prompts/parked-2026-07-17-brainstormed-queue.md (plan-echo builder). Produce a design proposal for my approval before building: four editable slots (Rows kept with ANDed conditions, Measure, Grouped by, Sorted) as dropdowns of real columns/values, matching-row count and per-group n shown before running, free text pre-filling the form, the confirmed form executing in all output surfaces. Do not write feature code until I approve the design.
