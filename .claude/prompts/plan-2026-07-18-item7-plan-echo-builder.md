# Item 7 — Plan-echo builder (approved design, ready to build)

**Status: DESIGN APPROVED 2026-07-18.** This is a paste-ready prompt for a
fresh session to build item 7 of
`.claude/prompts/parked-2026-07-17-brainstormed-queue.md` — the "surefire
accuracy" plan editor. Read that file's item 7 section for the original
brainstormed scope; this document is the finalized design that supersedes
its open questions (all resolved below).

## Why this exists

Free text alone can't be surefire for multi-condition requests like "UTI
treatment durations for levofloxacin ranked by prescriber" — parser coverage
grows combinatorially and every new phrasing pattern adds silent-failure
surface (see items R7 and 4, both silent-drop bugs of that shape). The fix
is never letting the parse stay invisible: translate the sentence into a
visible, editable plan the owner confirms before it runs.

## Design (owner-approved, 2026-07-18)

### Four editable slots

1. **Rows kept** — filter conditions, each `column = value` (equality only
   in this build; no contains/greater-than/not-equal yet — that's a
   follow-on if needed later). Conditions are organized into **groups**:
   each group ANDs its conditions together; multiple groups are combined
   with OR. Example: group 1 = `Drug = cephalexin AND Diagnosis = cystitis`;
   an optional group 2 = `Drug = amoxicillin AND Diagnosis = UTI` would OR
   with group 1. This covers real "(A and B) or C" needs without arbitrary
   nested parentheses — UI is just "add a condition" / "add another group."
2. **Measure** — dropdown of `count | sum | average | median`, over a real
   numeric column. (Median is new — `aggregate.js` currently only supports
   count/sum/average; add it here.)
3. **Grouped by** — one or two columns (crosstab). Two-column grouping must
   now support a real Measure (not count-only as it is today) — this is the
   headline case item 4 flagged as needing item 7: "average duration by
   ward and diagnosis."
4. **Sorted** — becomes part of the saved/confirmed plan itself, not a
   separate post-run UI toggle the way `sortMode` in `ChartsPanel.jsx`
   works today. The plan should carry enough to reproduce the same sort on
   replay.

### Live preview before running

- Matching-row count (after all filter groups are applied).
- Per-group n once "Grouped by" is set (a ranking/average built on n=2 must
  announce itself — mirrors the spirit of existing honesty rules elsewhere
  in the app).
- Needs a new lightweight count-only pass — reuse `applyFilter` and the
  grouping primitives already in `src/logic/charts/aggregate.js` rather
  than re-running the full `buildDataset`/`buildCrosstabDataset` path.

### Plain-English summary line

Shown above the Run button, always rendered from a **generic, literal
template** — never invented wording, never a role-guessing natural-language
generator (a clinical-vocabulary version was considered and explicitly
rejected 2026-07-18 in favor of staying honest across arbitrary datasets).

Format: `"<Aggregate> of <measure column>, for rows where <condition> and
<condition> [or <condition> and <condition>...], grouped by <column>[,
<column>], sorted by <sort>."`

Example: *"Average of Duration_days, for rows where Drug = cephalexin and
Diagnosis = cystitis, grouped by Prescriber."*

Every word in the summary must be a real column name or a real value from
the sheet — no synthesized phrasing.

### Free text pre-fills the form

Existing `resolveChartRequest` / matcher output should populate these same
four slots where it already has a confident read (e.g. an existing cohort
filter becomes one condition in one group; an existing crosstab request
populates Grouped by). Anything the parser can't confidently fill is left
empty for the owner to complete by hand — never guessed into a slot.

### Execution

The confirmed form is what actually runs, in **all output surfaces** the
app currently has (in-app chart result; this may also imply Excel-recipe /
R-script surfaces if this plan type is meant to be replayable the way other
transforms are — confirm with the owner if that's in scope for this build
or a later one before assuming it). Item 4's silent-drop guardrail stays
active regardless as the safety net.

### UI placement

No existing modal/"edit before running" pattern exists in the codebase.
Reuse the dropdown `<select>` controls `ChartsPanel.jsx`'s `applyPlan`
already binds to (same state, same columns) rather than building new
control widgets — but the multi-slot layout, condition groups, and
preview-count/summary-line are new UI, added as a collapsible panel in the
existing chart panel (not a separate modal).

## Explicitly decided (do not re-litigate)

- Equality-only filter conditions in this build (contains/>/< deferred).
- AND-within-group, OR-across-groups (not full arbitrary nested parens).
- Crosstab + measure support added now (was count-only before).
- Median measure added now.
- Sort becomes part of the saved plan, not a post-hoc toggle.
- Summary line is the generic literal template — NOT natural/colloquial
  phrasing. (A clinical-vocabulary natural-language version was proposed
  and rejected in favor of this.)

## Per-item workflow (standard for this repo)

Failing test first (synthetic fixtures only, never real owner data) →
implement → full suite green → live-verify in the browser
(`preview_start`, `.claude/launch.json` "TidyTable dev server") → commit →
update `docs/prompting-guide.md` (new capability + any limitations it
resolves) and mark item 7 SHIPPED in place in
`.claude/prompts/parked-2026-07-17-brainstormed-queue.md`, in the same
commit. Commit locally; do not push to `main` without the owner's explicit
go-ahead (pushing publishes the live site).

## Paste-ready prompt

> In ~/Downloads/TidyTable, build item 7 per the approved design in
> `.claude/prompts/plan-2026-07-18-item7-plan-echo-builder.md` (plan-echo
> builder). Follow that document's design exactly — it is already
> owner-approved, do not re-derive or re-ask the resolved questions listed
> under "Explicitly decided." Four slots (Rows kept as AND-groups combined
> with OR, Measure incl. new median, Grouped by with crosstab+measure
> support, Sorted saved as part of the plan), live matching-row count and
> per-group n before running, generic literal plain-English summary line,
> free text pre-fills what it confidently can and leaves the rest for the
> owner to fill by hand. Reuse existing dropdown controls in
> `ChartsPanel.jsx`'s `applyPlan` state rather than building new widgets;
> add a collapsible panel, not a modal. Test-first with synthetic fixtures,
> full suite green, live-verify, update `docs/prompting-guide.md` and mark
> item 7 SHIPPED in the parked-queue file in the same commit. If the
> "all output surfaces" execution scope (Excel/R replay vs. chart-only) is
> ambiguous once you're in the code, ask the owner rather than assuming.
