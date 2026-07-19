# TidyTable — Handoff after parked item 3 (CSN/MRN duplicates + PHI mode) (2026-07-18)

> **SUPERSEDES** [handoff-2026-07-18-p4-3-and-parked4-done.md](handoff-2026-07-18-p4-3-and-parked4-done.md).
> The canonical parked-items list is still
> `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` (item 3 marked
> SHIPPED in place this session).

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb`:
`main...origin/main [ahead 46]` at commit `a236572`, working tree clean
apart from this handoff (committed as a docs commit right after this file).

Baseline was 1070 passing tests; now **1098 passing (167 files)**, all green.

Repo: `~/Downloads/TidyTable`. Core promise: **never guess, never silently
drop data.** Folder is cloud-synced — commit locally often. PRIVACY: never
read the owner's real files — synthetic fixtures only.

## What's done (by item ID)

1. **Parked item 3** `a236572` — Step-2 duplicate CSN/MRN handling + PHI
   mode, all five scope parts (a)–(e) from the parked file:
   - (a) `idColumnRole()` in `src/logic/checkup/scan.js`: CSN /
     PAT_ENC_CSN_ID / encounter-id → encounter; MRN / medical record number /
     patient-id → patient. By NAME — works when the column is nowhere near
     unique. Name-recognized columns skip the generic looks-unique card.
   - (b) Encounter card: one-tick removal of exact-copy rows
     (`dedupeEncounterRows` in normalizers.js); repeated IDs whose rows
     differ render side by side (`DifferingGroups` in CheckupPanel.jsx),
     review-only by design. Blank-ID copies are never touched by this fix.
   - (c) MRN card: repeats framed as often legitimate; optional
     `keepOneRowPerPatient` with survivor policy asked via ClarifyBox
     (first/last by date column, most complete, or sheet order; ties keep
     sheet order). Blank-MRN rows always kept. Deliberate scope call: a
     patient whose repeats are ALL exact copies is left to the generic
     duplicate-rows finding (double-flagging made "remove the duplicates"
     ambiguous in the free-text box).
   - (d) Three surfaces + never silent: worker transform (ops inlined ES5),
     Excel steps (sort + Remove Duplicates with honest blank-ID caveats),
     real base-R script (`buildRScript` in buildFixPlan.js) printing row
     counts to check against the cleaning log. Removed rows ride on the
     result card ("See the N removed rows", ResultsListPanel.jsx) and are
     never persisted; Undo restores them. Recipes replay both ops with
     fuzzy re-matching of BOTH the ID column and the policy's date column
     (replay.js).
   - (e) PHI mode: checkbox in Step 1's privacy fieldset (UploadPanel.jsx).
     Disables AI full mode (radio disabled + `buildDataContext` capped to
     sample as belt-and-braces), stops persisting the results list and wipes
     what's stored (App.jsx effect); the flag itself persists
     (`tidytable_phi_mode`) so it stays on across visits. Session log and
     recipe still persist (column names/counts only) — that's the recorded
     scope.
   - 28 tests: `src/logic/checkup/parked3-csn-mrn.test.js` (21) +
     `src/parked3-csn-mrn.dom.test.jsx` (7). Live-verified with a synthetic
     CSV through the real upload input: both cards, one-tick removal,
     survivor question, removed-rows fold, Excel/R tabs, Undo, PHI radio
     lock + storage wipe.
   - Note: Step 10's long↔wide reshape was NOT literally reusable for the
     collapse (it pivots measure name/value pairs; this is surviving-row
     selection), so the collapse is a new self-contained ES5 op in
     normalizers.js — required anyway for worker inlining.
2. Owner guide `docs/prompting-guide.md` — Step 2 CSN/MRN block rewritten,
   PHI mode added to the Privacy section, limitation #5 marked fixed.

## What's NOT done — the remaining queue

Owner's recorded order (parked file header): item 4 ✓ → item 3 ✓ →
**item 1 → item 7**, then the spec's P5-4/P5-5.

- **Parked item 1 (NEXT)** — crosstab cohort filter + example chips +
  partial-parse honesty. `finishCrosstabPlan` in
  `src/logic/charts/textToChart.js` hardcodes `filter: null`. Scope (a)–(c)
  in the parked file; design rule: chips carry their already-resolved plan,
  clicking never re-parses.
- **Parked item 7** — plan-echo builder: SCOPING/DESIGN PASS ONLY, owner
  approval required before any feature code.
- **Parked items 2, 5, 6** — small/stale; owner hasn't prioritized them.
- **From the spec:** P5-4 Office exports (deps `pptxgenjs` + `docx`
  pre-approved 2026-07-11, lazy-load, check bundle size after build) and
  P5-5 ggplot2 figure code (must cover all P6 chart types incl. facet_wrap).

## Why this is a good stopping point

Item 3 was the largest parked item and shipped as one complete verified
unit — nothing half-built, suite green, one self-contained commit. The next
item (parked 1) is an independent chart-pipeline change that shares nothing
with this session's checkup work.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main`.
2. `npx vitest run` — expect **1098 passing (167 files)**. If different, stop
   and diagnose (cloud-sync reversion is the classic cause; `git log` should
   show `a236572` plus one docs commit for this handoff).
3. No owner decision pending: the recorded order says parked item 1 next.
   Only ask if the owner wants to reorder (e.g. pull P5-4 forward, or run
   item 7's design pass first).
4. Per-item workflow: read the scope in
   `.claude/prompts/parked-2026-07-17-brainstormed-queue.md` → failing test
   first (synthetic fixtures) → implement → full suite green → live-verify in
   the browser (`preview_start`, `.claude/launch.json` "TidyTable dev
   server") → commit named by the item ID → update `docs/prompting-guide.md`
   and the parked file in the same commit.
5. Push/deploy only on the owner's explicit say-so — 47 local commits will be
   ahead of origin after the docs commit.
