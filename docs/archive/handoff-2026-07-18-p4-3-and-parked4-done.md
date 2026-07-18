# TidyTable — Handoff after P4-3 (picklist vocabularies) + parked item 4 (2026-07-18)

> **SUPERSEDES** [handoff-2026-07-17-p5-zero-dep-exports-done.md](handoff-2026-07-17-p5-zero-dep-exports-done.md)
> — the owner pulled P4-3 forward ahead of P5-4/P5-5 (explicit instruction
> 2026-07-18: "start with P4-3, then the parked list"), so the spec order in
> that handoff is no longer the plan. The canonical parked-items list is
> still `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` (items 4
> and the "still queued from the spec" section updated in place this session).

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb`:
`main...origin/main [ahead 44]` at commit `dfc80d3`, working tree clean
apart from this handoff (committed as a docs commit right after this file).

Baseline was 1039 passing tests; now **1070 passing (165 files)**, all green.

Repo: `~/Downloads/TidyTable`. Core promise: **never guess, never silently
drop data.** Folder is cloud-synced — commit locally often. Spec:
`.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`. PRIVACY:
never read the owner's real files — synthetic fixtures only.

## What's done (by item ID, one commit each)

1. **P4-3** `1ffb6b9` — Excel data-validation picklists read as column
   vocabularies. New zero-dependency zip+XML reader (`src/logic/vocab/zip.js`
   + `validationLists.js`) pulls `<dataValidation type="list">` out of the
   .xlsx directly (SheetJS CE drops them): inline lists, cell-range lists on
   any sheet, named ranges, and the x14 extLst variant. Wired three places:
   - Step 2: new warn-only finding "Values not on the X dropdown list"
     (`scan.js findNotInPicklist`) — flags typed/pasted values that bypass
     Excel's own dropdown check.
   - Step 3 + charts: picklist terms join both `valueIndex` builders
     (`matcher.js`, `textToChart.js`), so a legal term with zero matching
     rows ("cUTI") answers an honest 0 and feeds closest-things chips.
   - `parseWorkbookFile` attaches `sheet.vocab = { header: [terms] }`;
     `deriveSheet(name, rows, prev)` carries it across checkup fixes
     (App.jsx call updated).
   15 tests (13 logic + 2 DOM). Live-verified with a synthetic picklist
   .xlsx driven through the real upload input: Step 2 card flagged the
   planted typo, "How many rows have cUTI?" answered 0 rows.
2. **Parked item 4** `dfc80d3` — matcher.js two-column silent-drop fixed,
   both scope parts:
   - "by A and B" group-bys (and/&/+ variants, all aggregation families)
     decline with reason `two-column-group` and two clickable one-column
     alternative chips (each re-verified via matchRequest before offering;
     rendered under the Step 3 notice, `.notice-alternatives` in App.jsx).
   - Generic guardrail `findDroppedColumns` (exported from matcher.js,
     called in runOffline on every confident match): a request naming a
     real column the resolved plan doesn't use declines (`unused-column`)
     instead of answering — also caught "most common drug by ward and
     diagnosis", which used to answer by ranking Ward.
   - Explicitly out of scope (per the parked file): real averaged
     crosstabs — that's item 7's territory.
   16 tests (15 logic + 1 App-level DOM). Live-verified: decline + chips
   render, chip click fills the box and produces the answer card.
3. Owner guide `docs/prompting-guide.md` — Step 2 dropdown-check block,
   Step 3 known-terms block, limitation #1 rewritten as fixed.

## What's NOT done — the remaining queue

Owner's recorded order for the parked work (from the parked file header,
owner-reviewed 2026-07-17): item 4 ✓ → **item 3 → item 1 → item 7**.

- **Parked item 3 (NEXT)** — Step-2 duplicate CSN/MRN handling + PHI mode.
  Follow scope (a)–(e) in `.claude/prompts/parked-2026-07-17-brainstormed-queue.md`:
  name-based CSN/MRN column recognition; encounter-duplicate removal with
  preview; optional keep-one-row-per-patient with surviving-row choice
  (reuse Step 10's reshape machinery in `ShelfPanel.jsx`); never silent,
  undoable, all three surfaces (in-app result, Excel recipe, R script);
  PHI-mode toggle disabling AI full mode + results persistence
  (`sessionPersistence.js`). Big item — budget a full session.
- **Parked item 1** — crosstab cohort filter + example chips +
  partial-parse honesty (`finishCrosstabPlan` in textToChart.js hardcodes
  `filter: null`). Chips must carry already-resolved plans, never re-parse.
- **Parked item 7** — plan-echo builder: SCOPING/DESIGN PASS ONLY, owner
  approval required before any feature code.
- **Parked items 2, 5, 6** — small/stale; owner hasn't prioritized them.
- **From the spec (order now behind the parked list per owner):** P5-4
  Office exports (deps `pptxgenjs` + `docx` pre-approved 2026-07-11,
  lazy-load, check bundle after `npm run build`) and P5-5 ggplot2 figure
  code (must cover all P6 chart types incl. facet_wrap small multiples).

## Why this is a good stopping point

Two items shipped as complete verified units with nothing half-built; the
suite is green and both commits are self-contained. The next item (parked 3)
is the largest remaining parked item, touches three surfaces plus a privacy
toggle, and deserves a fresh session's full budget.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main`.
2. `npx vitest run` — expect **1070 passing (165 files)**. If different,
   stop and diagnose (cloud-sync reversion is the classic cause; `git log`
   should show `dfc80d3` — plus one docs commit for this handoff).
3. No owner decision pending: the recorded order says parked item 3 next.
   Only ask if the owner wants to reorder (e.g. pull P5-4 back forward).
4. Per-item workflow: read the scope in the parked file → failing test
   first (synthetic fixtures) → implement → full suite green → live-verify
   in the browser (`preview_start`, `.claude/launch.json` "TidyTable dev
   server") → commit named by the item ID → update
   `docs/prompting-guide.md` (limitations + privacy for item 3) and the
   parked file in the same commit.
5. Push/deploy only on the owner's explicit say-so — 45 local commits will
   be ahead of origin after the docs commit.
