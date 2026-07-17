# TidyTable — Handoff after P4-4 done (2026-07-17)

> **SUPERSEDED** by [handoff-2026-07-17-p6-1-done.md](handoff-2026-07-17-p6-1-done.md)
> — this handoff's open question (P6-1 vs. the Step-2 example-chips item)
> was asked and answered in that later session; P6-1 is now done too.

> **SUPERSEDES** [handoff-2026-07-17-p4-1-p4-2-p4-6-done.md](handoff-2026-07-17-p4-1-p4-2-p4-6-done.md)
> — that handoff's one open question (which P4-4 UI shape) was asked and
> answered this session; P4-4 is now done.

Branch: `main`, off `main`. **NOT pushed** — TidyTable rule: never push to
`main` without the owner's explicit go-ahead (pushing publishes the live site
at https://jojohuhu-git.github.io/TidyTable/). `git status -sb` shows
`main...origin/main [ahead 24]` (this session's 1 commit, plus the 23 prior
commits already committed but never pushed).

Baseline this session was **905 passing (141 files)**, confirmed clean before
any new work, per the `resume` skill. Now **912 passing (143 files)**, all
green, working tree clean at commit `cca639d`.

Repo: `~/Downloads/TidyTable`. Core promise that constrains all work: **never
guess, never silently drop data.** Folder is cloud-synced — commit locally
often. Queue/spec: `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
("Execution order" section, step 7: `P4-1 → P4-2 → P4-6 → P4-4`, now
complete). PRIVACY: never read the owner's real files — synthetic fixtures
only.

## What's done this session

**P4-4** (check every sheet in Step 2, not just the first) — `cca639d`.
Owner decision (asked, not defaulted, at the start of this session): a
**combined findings list labeled by sheet**, not per-sheet tabs.

- `scan.js`: new `checkupWorkbook(sheets)` runs the existing `checkupSheet`
  against every sheet and returns one combined list with globally unique ids
  (`s{sheetIndex}-{f.id}`, since `checkupSheet` resets its own id counter per
  call). `checkupSheet` itself is unchanged — still single-sheet, still used
  directly by all its existing tests.
- `CheckupPanel.jsx`: prop changed from `sheet` to `sheets` (array). Shows a
  small sheet-name badge (`.finding-sheet` in `styles.css`) on each finding,
  but only once more than one sheet is present — a single-sheet workbook's
  UI is unchanged. Each fix the panel emits now carries `sheet: f.sheet` so
  the caller knows which sheet it targets. Help-panel copy updated ("scans
  every sheet in your file" / "your sheet"; dropped the now-false "only
  checks the first sheet" limitation line).
- `App.jsx` `handleApplyFixes`: previously hardcoded to `workbook.sheets[0]`.
  Now groups the selected fixes by the sheet name each one carries, runs
  `buildFixPlan` once per affected sheet, updates each sheet independently,
  and records one result card per affected sheet (a sheet with zero ticked
  fixes is never touched — its rows and columns are untouched, byte for
  byte).
- Test fixtures updated for the new `sheets` prop and the new `sheet` field
  on emitted fixes: `test/CheckupPanel.dom.test.jsx`,
  `src/components/a6-category-variant-picker.dom.test.jsx`. New coverage:
  `src/logic/checkup/p4-4-multi-sheet.test.js` (scan.js logic) and
  `src/components/p4-4-multi-sheet-checkup.dom.test.jsx` (UI labeling +
  correct fix routing).
- Live-verified in the browser with the two-sheet example workbook
  (Encounters, Roster): Step 2 showed Encounters' 5 findings, each labeled
  "Encounters"; Roster's clean data correctly produced zero findings (not a
  bug — confirmed by switching to the Roster tab, its data was untouched).
  Applied 3 fixes; Encounters went from 6 to 5 rows (duplicate removed),
  Roster stayed exactly 4 rows. No console errors.
- **Known, pre-existing limitation, not introduced by this fix, explicitly
  out of scope here**: recipe/routine replay (`ReplayPanel.jsx`,
  `replay.js`) is still single-sheet — it only ever loads
  `wb.sheets[0]` for the file being replayed against. A routine recorded
  from a multi-sheet Apply (fixes from two sheets in one recipe) will still
  only replay against whichever single sheet is uploaded next month; column
  names are fuzzy-matched, so a fix meant for one original sheet could
  coincidentally match a same-named column on an unrelated replay sheet.
  This risk already existed in kind (replay has always trusted recorded
  column names over which sheet they came from); P4-4 only widens how many
  sheets' worth of steps can land in one recipe. Extending replay to be
  sheet-aware is real, separate work — flag it to the owner before starting
  P4-3 or the P6/P5 workstreams if she saves and replays a routine that
  spans multiple sheets.

## What's NOT done — the remaining queue

Per the spec's execution order (steps 1–6 done in prior sessions; step 7 —
P4-1 → P4-2 → P4-6 → P4-4 — is now fully done):

- **P4-3** (Excel data-validation picklists as vocabularies) — next per
  execution order, deferred until after P5-4 per the spec's own note
  ("largest unknown, intentionally last"). Needs parsing
  `xl/worksheets/*.xml` `dataValidation` entries directly from the .xlsx
  zip (SheetJS CE does not surface them). Medium effort.
- **Step 2 StepHelpPanel example chips** — still not started; flagged in
  **five** prior handoffs now (including this one), still true — ask before
  starting.
- **P1-4a's chart branch** — still deferred; recommended (not approved) to
  bundle with P6. Ask before starting either.
- **P6-1 … P6-5** — complex graphics (stacked/grouped/100% bars, histogram +
  box/dot, cohort wording, Pareto, small multiples). P6-1 eventually
  REPLACES P3-2's interim two-column decline — do not remove that decline
  until P6-1 ships. Load the dataviz skill before any of these.
- **P5-1 / P5-2 / P5-3 / P5-6** then **P5-4 / P5-5** — publication exports.
  P4-5 (committee Word report) ships as part of P5-4, same dependency.

All decisions A–E + P4/P5/P6 are already resolved in the spec's DECISIONS
section — do NOT re-ask those. **No open judgment call remains from this
session** — P4-4's only open question (combined list vs. per-sheet tabs) was
asked and answered before coding began.

## Why this is a good stopping point

P4-4 is fully done: scan, apply, and UI are all multi-sheet-aware, tested
(logic + DOM), and live-verified. The whole P4 sub-queue (P4-1, P4-2, P4-6,
P4-4) from this and prior sessions is now complete except P4-3, which the
spec itself defers until after P5-4 — so there is nothing left to pick up
in P4 today. The next item per execution order is genuinely a new
workstream (P6's complex graphics), which needs the dataviz skill and a
fresh session's full attention rather than being squeezed in here.

## Resuming

1. `cd ~/Downloads/TidyTable && git checkout main` (stay on main; repo allows
   direct commits to main but **never push** without the owner's go-ahead).
2. Run `npx vitest run` — expect **912 passing (143 files), all green**
   before any new work. If the counts differ, stop and diagnose.
3. Per execution order, the next item is **P6-1** (grouped and stacked
   bars) — but the spec places P4-3 before P5, and P6 before P5, in the
   stated order `... 5. P6-1→P6-5, 6. P5-1→P5-6, ... 9. P4-3`. Confirm with
   the owner she still wants to proceed in that order (P6 next) rather than
   picking up the smaller Step 2 example-chips follow-on first — ask, don't
   default, since the chips item has been sitting flagged for five sessions
   running.
4. Follow the per-item workflow: reproduce → failing test (synthetic
   fixture, never the owner's real data) → confirm red → fix minimally →
   full suite green → live-verify anything UI-observable (start the dev
   server directly with `npm run dev` in `~/Downloads/TidyTable`, since this
   repo's own `.claude/launch.json` config `"TidyTable dev server"` — port
   5175 — isn't picked up by `preview_start` when the harness's cwd is a
   different repo; a dev server may already be running from a prior session
   on that port) → commit named by item ID (e.g. `P6-1: ...`).
5. Push/deploy only on the owner's explicit say-so — including the 24
   commits already sitting locally ahead of origin.
