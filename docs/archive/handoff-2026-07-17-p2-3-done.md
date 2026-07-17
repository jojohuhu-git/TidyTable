# TidyTable — Handoff after P2-3 (plain-English cleaning box in Step 2) done (2026-07-17)

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 14]` (this session's 1 commit, plus the 13 prior
commits already committed but never pushed).

Baseline this session was **829 passing (135 files)**, confirmed clean before
any new work, per the `resume` skill. Now **842 passing (136 files)**, all
green, working tree clean at commit `bbcf4d0`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section). PRIVACY: never read the owner's real files —
synthetic fixtures only.

## What's done this session

1. **P2-3** (plain-English cleaning box in Step 2) — `bbcf4d0`. New
   `src/logic/checkup/cleanRequestMatcher.js`: `matchCleanRequest(request,
   findings)` maps free text onto Step 2's checkup findings via 4 keyword
   intents (duplicates → `duplicateRows`/`duplicateIds`; dates → `textDates`/
   `epochDates`; missing/N/A/blank → `missing`; spelling/variant →
   `categoryVariants`). Column disambiguation reuses `columnKey()` from
   `src/logic/recipes/recipe.js` (the same folded-name matcher recipe replay
   uses) — checks whether a candidate finding's column name is
   substring-contained in the folded request text, 3+ chars, same floor as
   the offline engine's `fuzzyColumn`. Result kinds: `matched` (unambiguous —
   auto-selected), `ambiguous` (2+ candidate columns, none named — rendered
   as pick-a-column buttons, never guessed), `not-found` (intent recognized,
   no such finding exists — honest per-intent message), `not-fixable`
   (finding exists but scan already marked it not auto-fixable, e.g.
   `duplicateIds` or blank-only `missing` — reuses the finding's own
   `detail` sentence so the wording can never drift from what the scan
   itself says), `unrecognized` (Step-3-style honest capability message +
   "Add an AI key… describe it in Step 3" — no live AI call is wired for
   this box; the spec's "nothing new is computed" constraint means an actual
   Claude-driven cleaning decision was out of scope for P2-3 itself).
   - `src/components/CheckupPanel.jsx`: new `selectFinding(f)` (select-only,
     never toggles off, un-dismisses if the user had skipped it) plus
     `submitCleanRequest`, wired to a `<form>` under the P2-4 `StepHelpPanel`
     — text input + "Check" button, feedback line or ambiguous-column
     buttons below it. Stale P2-4 comment ("P2-3 hasn't shipped yet") fixed.
   - CSS: `src/styles.css` — new `.clean-request-*` rules matching the
     `.step-help`/`.prompt-box` conventions already in the file.
   - Tests: 13 new (829 → 842) — 10 in
     `src/logic/checkup/cleanRequestMatcher.test.js` (one per result kind,
     including the ambiguous→resolved-by-naming-a-column flow) + 3 in
     `test/CheckupPanel.dom.test.jsx` (matched request ticks + applies the
     real fix, not-found message, unrecognized fallback keeps the text so
     it can be edited).
   - Live-verified against the example workbook (Encounters sheet, 6 rows):
     "remove the duplicates" ticked Duplicate rows; "fix the dates" ticked
     the Visit_date finding and correctly opened the Month/Day/Year vs.
     Day/Month/Year policy question (needsPolicy honored, not bypassed);
     answering it, then pressing Apply, produced "Started with 6 rows and
     ended with 5 rows" — 1 duplicate removed, 1 date standardized, both
     confirmed in the cleaning log. "make the diagnoses tidy" (unrecognized)
     showed the honest fallback and left the text in the box for editing.
     No console errors at any step.

## What's NOT done — the remaining queue

- **Follow-on not in the original P2-3 scope**: Step 2's `StepHelpPanel` still
  has no clickable "Try these" examples (P2-4 deliberately left it without
  them because P2-3 hadn't shipped). Now that the free-text box exists, it
  could gain 2-3 example chips the same way Steps 7/9/10 do. Not started; no
  owner decision recorded on whether to do this — ask before starting, since
  it's outside P2-3's stated scope.
- **P1-4a's chart branch** — still deferred, no owner decision pending;
  recommended (not yet approved) to bundle with P6 since both need new
  `aggregate.js` grouping logic. Ask the owner before starting either.
- **P3-2 / P3-3** — Step 9 interim two-column decline, then request-aware
  chart highlighting. (P3-1 is done — R6 live-verify closed 3 sessions ago.)
- **P6-1 / P6-2 / P6-4 / P6-3 / P6-5** — complex graphics (stacked/grouped/
  100% bars, histogram + box/dot, cohort wording, Pareto, small multiples).
- **P5-1 / P5-2 / P5-3 / P5-6** then **P5-4 / P5-5** — publication exports.
- **P4-1 / P4-2 / P4-6 / P4-4** then **P4-3** — robustness/reach.

All decisions A-E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask them. No new judgment call came up this session that
wasn't already covered by the spec's existing decisions.

## Why this is a good stopping point

P2-3 is the last item in the spec's "Steps 2, 3, 9" execution-order group —
Steps 2, 3, 7, 9, 10 now all have a working plain-English or example-chip
path, and P2-3 specifically closes the gap P2-4 flagged (no free-text box to
give Step 2's help panel something honest to demo). It's independently
useful, fully tested, and live-verified end-to-end including the trickiest
path (ambiguous match → policy question → real fix applied). Nothing here
blocks or was blocked by any of the remaining P3/P4/P5/P6 queues.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **842 passing (136 files), all green**
   before any new work. If the counts differ, stop and diagnose.
3. No item in the execution-order spec is left unstarted-but-approved for
   Steps 2/3/9 — the next work is either the optional StepHelpPanel-examples
   follow-on (ask first, it's new scope) or picking up **P3-2** per the
   spec's stated order. Ask the owner which queue to prioritize next; do not
   default.
4. Follow the per-item workflow: reproduce → failing test (synthetic
   fixture, never the owner's real data) → confirm red → fix minimally →
   full suite green → live-verify anything UI-observable (start the dev
   server directly with `npm run dev` in `~/Downloads/TidyTable`, since this
   repo's own `.claude/launch.json` config `"TidyTable dev server"` — port
   5175 — isn't picked up by `preview_start` when the harness's cwd is a
   different repo; or open the browser at `http://localhost:5175/TidyTable/`
   once `npm run dev` is running) → commit named by item ID.
5. Push/deploy only on the owner's explicit say-so — including the 14
   commits already sitting locally ahead of origin.
