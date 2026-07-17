# TidyTable — Handoff after P2-2 (safe/needs-your-call split) done (2026-07-17)

**SUPERSEDED** by [handoff-2026-07-17-p2-4-done.md](handoff-2026-07-17-p2-4-done.md) —
P2-4 (the next item in this file's queue) is now done too. Read the newer file instead.

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 10]` (this session's 1 commit, plus the 9 prior
commits already committed but never pushed).

Baseline this session was **816 passing (135 files)**, confirmed clean before
any new work, per the `resume` skill. Now **818 passing (135 files)**, all
green, working tree clean at commit `6177b07`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section). PRIVACY: never read the owner's real files —
synthetic fixtures only.

## What's done this session

1. **P2-2** (safe/needs-your-call grouping + "Tick all safe fixes") —
   `6177b07`. `src/components/CheckupPanel.jsx` (Step 2's findings list):
   fixable findings now split into two `<section>` groups —
   "Safe fixes — nothing is lost" (any fix without `f.fix.needsPolicy`:
   duplicates, missing values, numbers-as-text, epoch dates, unit-suffix
   numbers, category-spelling merges) and "Needs your call" (fixes that ask a
   policy question first: ambiguous date order, below/above-limit results).
   The "Safe fixes" header carries a one-click **"Tick all safe fixes"**
   button that selects every safe finding's checkbox at once — it never
   touches "needs your call" findings, so nothing requiring a judgment call
   can be silently applied. The non-fixable "for your review" flags got their
   own third section header for the same at-a-glance clarity.
   - Wording: re-passed the epoch-date finding's detail text (the spec's
     named example) through a read-aloud-for-a-non-coder check. It used to
     open with "stored as dates from 1899-1900 (Excel's internal date
     epoch)…"; now opens with a plain sentence ("Excel auto-formatted N plain
     numbers in "X" as a date by mistake.") with the 1899/1900 technical
     explanation moved to a parenthetical that follows, still visible only
     inside the existing "What's this?" expander. No other finding's wording
     needed a rewrite — all other detail strings were already plain
     (duplicates, missing values, textNumbers, textDates, categoryVariants,
     censored, multiValue, mixedUnits use everyday words already).
   - Tests: `src/logic/checkup/p0-1-dates.test.js` — new case asserting the
     epoch detail's first sentence contains no "epoch"/"1899"/"1900" jargon
     while the technical string still appears later in the text.
     `test/CheckupPanel.dom.test.jsx` — new case asserting both group headers
     render, the censored (needs-your-call) finding is excluded from the safe
     section, and clicking "Tick all safe fixes" then Apply produces exactly
     the safe fixes' normalizers (`dedupeRows`, `trimCase` for the fixture
     used) and nothing else.
   - CSS: `src/styles.css` — new `.finding-group` / `.finding-group-head`
     rules; the "Tick all safe fixes" button reuses the existing `.btn
     btn-ghost` style rather than inventing a new variant.
   - Live-verified in the browser against the example workbook: Step 2 now
     shows "Safe fixes — nothing is lost" (3 items: duplicate rows, missing
     values, numbers-as-text in Duration_days) and "Needs your call" (2
     items: mixed-format dates, below-limit lab results). Clicking "Tick all
     safe fixes" ticked exactly the 3 safe items and left the 2 needs-your-
     call items unticked ("Apply 3 selected fixes"). No console errors.

## What's NOT done — the remaining queue

- **P2-4** (next per execution order) — per-step "How to use this step"
  collapsed panel (what it does / what it can't do yet / 2-3 clickable
  examples from the user's own column names) on every step card, generalizing
  Step 3's existing expander pattern to Steps 2, 7, 9, 10. Extends
  `examplePrompts.js`.
- **P2-3** — plain-English cleaning box in Step 2 ("Or tell me what to
  clean…") that maps requests onto findings the scan already found. Builds
  on P2-4's example-chip pattern per the execution order, so do it last.
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
section — do NOT re-ask them.

## Why this is a good stopping point

P2-2 is a complete, independently useful unit: Step 2's findings list now
makes the safe-vs-judgment-call distinction visible instead of implicit, with
a one-click shortcut for the common "tick everything safe" action, tested,
and live-verified end-to-end (grouping renders correctly, tick-all-safe
selects the right set, apply produces the right fixes). It doesn't block or
get blocked by P2-4/P2-3 — those are additive UI changes to the same
component, cleanly resumable from a green baseline.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **818 passing (135 files), all green** before
   any new work. If the counts differ, stop and diagnose.
3. Per the spec's execution order, the next item is **P2-4** (per-step "How
   to use this step" panels). No open owner decision is needed to start it.
   Ask the owner only if execution surfaces a new judgment call not already
   covered by Decisions A-E.
4. Follow the per-item workflow: reproduce → failing test (synthetic fixture,
   never the owner's real data) → confirm red → fix minimally → full suite
   green → live-verify anything UI-observable (start the dev server directly
   with `npm run dev` in `~/Downloads/TidyTable`, since this repo's own
   `.claude/launch.json` config `"TidyTable dev server"` — port 5175 — isn't
   picked up by `preview_start` when the harness's cwd is a different repo;
   or open the browser at `http://localhost:5175/TidyTable/` once `npm run
   dev` is running) → commit named by item ID.
5. Push/deploy only on the owner's explicit say-so — including the 10 commits
   already sitting locally ahead of origin.
