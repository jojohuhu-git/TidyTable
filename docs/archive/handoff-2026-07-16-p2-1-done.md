# TidyTable — Handoff after P2-1 (one-line findings) done (2026-07-16)

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 7]` (this session's 1 commit, plus the 6 prior
sessions already committed but never pushed).

Baseline this session was **815 passing (135 files)**, confirmed clean before
any new work, per the `resume` skill. Now **816 passing (135 files)**, all
green, working tree clean at commit `159d575`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section). PRIVACY: never read the owner's real files —
synthetic fixtures only.

## What's done this session

1. **P2-1** (one-line findings with progressive disclosure) — `159d575`.
   `src/components/CheckupPanel.jsx` (Step 2's findings list): each finding
   now renders as one line — checkbox + short title + count + "Skip" button
   (`.finding-line`) — instead of always showing the multi-sentence detail
   paragraph and sample chips inline. That detail text, sample chips, and
   (for spelling-variant findings) the merge-target chip picker now live
   inside a collapsed `<details className="finding-expander"><summary>What's
   this?</summary>...</details>`, matching the existing `<details>` pattern
   already used in `PromptPanel.jsx`'s "What kinds of questions work without
   AI" expander. The policy question (`ClarifyBox`, for below/above-limit
   findings) and the "Chosen: ..." confirmation line stay **outside** the
   expander, always visible when active, so a required policy answer is
   never hidden behind a collapsed panel.
   - CSS: `src/styles.css` — new `.finding-line` / `.finding-expander` rules;
     `.finding-count`/`.finding-dismiss` moved out of the checkbox `<label>`
     into the shared row so the "Skip" button (renamed from "Dismiss", same
     `.finding-dismiss` class) can sit on the same line without fighting the
     label's click-toggles-checkbox behavior.
   - Tests: `test/CheckupPanel.dom.test.jsx` — added one case asserting the
     expander exists, starts collapsed (detail text present in the DOM but
     not visible-by-default via the `open` attribute), and opens on click;
     the three pre-existing tests (tick+apply, policy-gated fix, dismiss)
     needed no changes and still pass unmodified.
   - Live-verified in the browser against the example workbook: Step 2 now
     shows ~5 findings as ~5 scannable lines; clicking "What's this?" on
     "Duplicate rows" expanded to show the detail sentence + one sample chip
     (`P4 · cystitis · cephalexin`); ticking the checkbox and pressing "Apply
     1 selected fix" cleaned 6 rows → 5 rows correctly. No console errors.

## What's NOT done — the remaining queue

- **P2-2** (next) — split findings into "Safe fixes — nothing is lost" vs
  "Needs your call" groups with plain headers, plus a one-click "Tick all
  safe fixes" button. Also re-passes every finding's title/detail text
  through a read-aloud-for-a-non-coder check (spec gives the epoch-date
  wording as an example needing a simpler first sentence).
- **P2-4** — per-step "How to use this step" collapsed panel (what it does /
  what it can't do yet / 2-3 clickable examples from the user's own column
  names) on every step card, generalizing Step 3's existing expander pattern
  to Steps 2, 7, 9, 10. Extends `examplePrompts.js`.
- **P2-3** — plain-English cleaning box in Step 2 ("Or tell me what to
  clean…") that maps requests onto findings the scan already found. Builds
  on P2-4's example-chip pattern per the execution order, so do it last.
- **P1-4a's chart branch** — still deferred, no owner decision pending;
  recommended (not yet approved) to bundle with P6 since both need new
  `aggregate.js` grouping logic. Ask the owner before starting either.
- **P3-2 / P3-3** — Step 9 interim two-column decline, then request-aware
  chart highlighting. (P3-1 is done — R6 live-verify closed in the prior
  session.)
- **P6-1 / P6-2 / P6-4 / P6-3 / P6-5** — complex graphics (stacked/grouped/
  100% bars, histogram + box/dot, cohort wording, Pareto, small multiples).
- **P5-1 / P5-2 / P5-3 / P5-6** then **P5-4 / P5-5** — publication exports.
- **P4-1 / P4-2 / P4-6 / P4-4** then **P4-3** — robustness/reach.

All decisions A-E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask them.

## Why this is a good stopping point

P2-1 is a complete, independently useful unit: Step 2's findings list is now
visually calm (one line per finding) with zero information loss (everything
still reachable via the expander), tested, and live-verified end-to-end
(tick → apply → cleaned rows). It doesn't block or get blocked by P2-2/P2-4/
P2-3 — those are additive UI changes to the same component, cleanly
resumable from a green baseline.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **816 passing (135 files), all green** before
   any new work. If the counts differ, stop and diagnose.
3. Per the spec's execution order, the next item is **P2-2** (safe/needs-your-
   call grouping + "Tick all safe fixes"). No open owner decision is needed to
   start it. Ask the owner only if execution surfaces a new judgment call not
   already covered by Decisions A-E.
4. Follow the per-item workflow: reproduce → failing test (synthetic fixture,
   never the owner's real data) → confirm red → fix minimally → full suite
   green → live-verify anything UI-observable (start the dev server directly
   with `npm run dev` in `~/Downloads/TidyTable`, since this repo's own
   `.claude/launch.json` config `"TidyTable dev server"` — port 5175 — isn't
   picked up by `preview_start` when the harness's cwd is a different repo;
   or open the browser at `http://localhost:5175/TidyTable/` once `npm run
   dev` is running) → commit named by item ID.
5. Push/deploy only on the owner's explicit say-so — including the 7 commits
   already sitting locally ahead of origin.
