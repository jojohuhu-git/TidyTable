# TidyTable — Handoff after P2-4 (per-step "How to use this step" panels) done (2026-07-17)

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 12]` (this session's 1 commit, plus the 11 prior
commits already committed but never pushed).

Baseline this session was **818 passing (135 files)**, confirmed clean before
any new work, per the `resume` skill. Now **829 passing (135 files)**, all
green, working tree clean at commit `5c5eeb7`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section). PRIVACY: never read the owner's real files —
synthetic fixtures only.

## What's done this session

1. **P2-4** (per-step "How to use this step" panels) — `5c5eeb7`. New shared
   `src/components/StepHelpPanel.jsx`: a collapsed `<details class="step-help">`
   with three parts — what the step does (one sentence), what it can't do yet,
   and (where the step has real input to fill) 2-3 clickable examples built
   from the user's own column names.
   - **Step 2** (`CheckupPanel.jsx`) gets the panel with NO clickable examples.
     Owner decision (asked, not defaulted): there's no text box to fill yet,
     and P2-3 (the plain-English cleaning box that would give chips something
     to run) hasn't shipped — a fake action would be dishonest.
   - **Step 7** (`StatsPanel.jsx`): new `buildStatsExamples()` in
     `src/logic/offline/examplePrompts.js` picks grouping/outcome column pairs
     from `columnPickerOptions()`, verified by actually calling `analyze()`.
     Clicking a chip sets both dropdowns and runs the comparison.
   - **Step 9** (`ChartsPanel.jsx`): new `buildChartExamplePrompts()` builds
     chart-request text verified through `resolveChartRequest()` — the SAME
     pipeline "Make this chart" runs, so a shown example is never a promise
     the chart box can't keep. Clicking a chip fills the text box and runs it.
   - **Step 10** (`ShelfPanel.jsx`): new `buildShelfExamples()` limited to the
     ONE operation (wide→long reshape) that needs only the first sheet — the
     other five operations need a second sheet uploaded, so no chip pretends
     to run them yet. Owner decision (asked, not defaulted): hide the
     second-sheet ops from "Try these" rather than show them disabled.
     Verified by actually calling `reshapeWideToLong()` and checking it
     produces real rows.
   - Step intro paragraphs on Steps 2, 7, 9, 10 (`App.jsx`) shrink to one
     sentence; detail moved into the new panel. The existing P1-10 multi-sheet
     disclosure sentences ("Only the first sheet, X, is used here.") stay
     conditional and unchanged — first attempt at this shrink accidentally
     broke that P1-10 test by duplicating the caveat unconditionally inside
     the panel; fixed by keeping it only in `App.jsx`'s conditional intro.
   - Step 3 (`PromptPanel.jsx`) was NOT touched — it already has the pattern
     P2-4 generalizes from (`buildExamplePrompts` + the offline-cheatsheet
     expander), so wrapping it in the new shared component would have hidden
     its already-good, always-visible example chips behind an extra click.
   - CSS: `src/styles.css` — new `.step-help` / `.step-help-does` /
     `.step-help-cant` / `.step-help-examples` rules, styled to match the
     existing `.offline-cheatsheet` / `.finding-expander` conventions.
   - Tests: 11 new (818 → 829) across `src/logic/offline/examplePrompts.test.js`
     (each builder's verification guarantee), `test/CheckupPanel.dom.test.jsx`,
     `test/StatsPanel.dom.test.jsx`, `test/ChartsPanel.dom.test.jsx`, and
     `src/components/shelf.dom.test.jsx` (panel presence + each example chip's
     end-to-end effect).
   - Live-verified in the browser against the example workbook (Encounters +
     Roster sheets): Step 2's panel shows with no examples; Step 7's
     "PatientID vs Diagnosis" chip filled both dropdowns and ran a real
     chi-square test; Step 9's "Diagnosis" chip filled the chart box and drew
     a real bar chart; Step 10's "Turn Diagnosis & Drug into one row each per
     PatientID" chip set the operation to wide→long and reshaped 6 rows into
     12. No console errors.

## What's NOT done — the remaining queue

- **P2-3** (next per execution order) — plain-English cleaning box in Step 2
  ("Or tell me what to clean…"), builds on P2-4's example-chip pattern per the
  spec's execution order. Once this ships, Step 2's StepHelpPanel should
  probably gain real clickable examples too (it was deliberately left without
  them this session because there was nothing honest for a chip to do).
- **P1-4a's chart branch** — still deferred, no owner decision pending;
  recommended (not yet approved) to bundle with P6 since both need new
  `aggregate.js` grouping logic. Ask the owner before starting either.
- **P3-2 / P3-3** — Step 9 interim two-column decline, then request-aware
  chart highlighting. (P3-1 is done — R6 live-verify closed 2 sessions ago.)
- **P6-1 / P6-2 / P6-4 / P6-3 / P6-5** — complex graphics (stacked/grouped/
  100% bars, histogram + box/dot, cohort wording, Pareto, small multiples).
- **P5-1 / P5-2 / P5-3 / P5-6** then **P5-4 / P5-5** — publication exports.
- **P4-1 / P4-2 / P4-6 / P4-4** then **P4-3** — robustness/reach.

All decisions A-E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask them. The two new judgment calls this session (Step
2's chips, Step 10's second-sheet ops) were asked and resolved as described
above — do NOT re-ask those either.

## Why this is a good stopping point

P2-4 is a complete, independently useful unit: every step in scope (2, 7, 9,
10) now has the same "How to use this step" pattern, each example chip is
individually verified against the same code path the real UI action calls
(never a promise the step can't keep), and it's tested and live-verified
end-to-end. It sets up P2-3 cleanly (the spec explicitly says P2-3 "builds on
P2-4's example-chip pattern") without having started any part of it.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **829 passing (135 files), all green** before
   any new work. If the counts differ, stop and diagnose.
3. Per the spec's execution order, the next item is **P2-3** (plain-English
   cleaning box in Step 2). No open owner decision is needed to start it
   (DECISION B already approved it). Ask the owner only if execution surfaces
   a new judgment call not already covered by Decisions A-E or this session's
   two resolved calls.
4. Follow the per-item workflow: reproduce → failing test (synthetic fixture,
   never the owner's real data) → confirm red → fix minimally → full suite
   green → live-verify anything UI-observable (start the dev server directly
   with `npm run dev` in `~/Downloads/TidyTable`, since this repo's own
   `.claude/launch.json` config `"TidyTable dev server"` — port 5175 — isn't
   picked up by `preview_start` when the harness's cwd is a different repo;
   or open the browser at `http://localhost:5175/TidyTable/` once `npm run
   dev` is running — a dev server may already be running from a prior
   session on this port) → commit named by item ID.
5. Push/deploy only on the owner's explicit say-so — including the 12 commits
   already sitting locally ahead of origin.
