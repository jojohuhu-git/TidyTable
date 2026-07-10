# TidyTable — Session kickoff (2026-07-09): apply the outstanding handoffs

> **STATUS (2026-07-09, later same day): the queue below is DONE.** All P0s, A1/A2, A3 (Levels 1
> and 2), A4, A5, B1-B5, and all seven P1s (P1-6..P1-12) are complete — 270 tests passing, branch
> `fix/2026-07-09-audit-findings` off `phase/5-charts`, not pushed. **Do not restart this queue.**
> For what's left and how to resume, read
> `.claude/prompts/handoff-2026-07-09-remaining-work.md` instead — it has the current test count,
> the "Resuming" steps, and the real remaining queue (P2-13..P2-23, B6-B12, A6, NEW-3/5/7/8/9/10).

You are working on **TidyTable**, a browser-only React + Vite app that cleans and analyzes messy
Excel files for spreadsheet/RStudio **novices** (often clinical data). Local repo:
`~/Downloads/TidyTable`. Live: https://jojohuhu-git.github.io/TidyTable/. Owner: Joanne
(jojohuhu-git) — explain everything in plain, jargon-free language (what and why, not just how).

Your job this session is to **work through the outstanding handoffs below in order**, one item at
a time, with a Vitest regression test for each. Do not try to hold all of it in your head at once —
open each handoff file as you reach it and follow it.

## Ground rules (do not violate)

- **House rules — the product's whole promise:** never guess, never silently drop or corrupt data;
  when the app can't handle a value honestly, it says so in plain English instead of producing a
  wrong number. The in-app result, the Excel recipe steps, and (where present) the R script must
  produce **identical numbers**.
- Plain, jargon-free UI copy. **No new dependencies.** All processing stays in the browser.
- **Do NOT push or merge.** The owner reviews everything locally before anything hits GitHub. The
  repo folder is **cloud-synced (reversion gotcha) — commit often** so work isn't lost.
- Tests: `npx vitest run`. Every fix needs a test that fails before and passes after. Baseline is
  ~141 passing — confirm the actual number first and keep them green.

## First steps

1. `cd ~/Downloads/TidyTable && git status && git branch --show-current` (expected branch:
   `phase/5-charts`), then `npm install` and `npx vitest run` to confirm the green baseline.
2. `npm run dev` to bring up the app (it defaults to port 5173/5174/5175 — check the output).
3. Read the three **active** handoffs listed below before writing code. Skim the reference/historical
   ones only if you need background.

## The handoffs — read in this order

### Active work (not yet applied — this is your queue)

1. **`.claude/prompts/fix-2026-07-06-audit-findings.md`** — confirmed, reproduced bugs. Do the
   **P0s first** (date corruption in `parseDates`; offline threshold counting `N/A` as 0; Haiku 400;
   false chi-square note; constant-group t-test NaN), then P1/P2. Each item is independently
   shippable — commit per item or per group.
2. **`.claude/prompts/handoff-2026-07-06-accuracy-ux.md`** — accuracy gaps a novice can't detect
   (Part A) plus the UX redesign for a novice audience (Part B). It has its own suggested order at
   the bottom. Do **not** duplicate the fix-prompt's P0s; do them from file 1 first.
3. **`.claude/prompts/datasets-2026-07-09-realworld-examples.md`** — findings driven by two real
   messy datasets (real PHI, **kept out of the repo**; build synthetic fixtures from their
   patterns). It maps fixtures to files 1 and 2 **and changes two of their conclusions**:
   - **NEW-1 refutes the accuracy-ux A1 note** that real `.xlsx` cells are safe true types — one
     file stores a duration column as 1900-epoch date/time-typed cells. Reconcile before coding P0-1.
   - **NEW-2 conflicts with fix-prompt P0-2** — `"5 Days"`/`"365 Days"` unit-suffix durations would
     be wrongly dropped by the stricter `toNumber`; add a strip-unit normalizer before coercion.
   Treat NEW-1 and NEW-2 as part of the P0-1/P0-2 work, not as a later cleanup.

### Reference / historical (context only — do not "resume" these)

- **`.claude/prompts/build-clinical-workbench.md`** — the master build spec for the workbench
  (Phases 0–5, 8 acceptance scenarios). Phases 0–5 are already built; use this only to understand
  intended architecture and the acceptance scenarios your fixes must not regress.
- **`.claude/prompts/handoff-2026-07-04-validation-sharing-api-alternatives.md`** — earlier Opus
  handoff on accuracy validation, sharing, and reducing API dependence. Background; several ideas
  were absorbed into the workbench and the 2026-07-06 handoffs.
- **`.claude/prompts/handoff-2026-07-05-workbench-phase2.md`** and **`-phase3.md`** — build-phase
  resume notes from when the workbench was under construction. Historical now that Phases 0–5 exist.
- **`.claude/prompts/build-offline-formula-engine.md`** — **superseded** by the workbench spec.
  Reference only; do not build from it.

## Suggested execution order (combining all three active files)

1. **fix-prompt P0-1 + datasets NEW-1** (date corruption, including the `.xlsx` 1900-epoch-date
   duration column) and **fix-prompt P0-2 + datasets NEW-2** (non-numeric/N-A counting + the
   unit-suffix normalizer) — resolve these together; they interact.
2. **accuracy-ux A1, A2** (CSV parse corruption; compound questions dropping conditions) — the
   remaining silent-wrong-answer P0s. Use datasets NEW-4 (`CSN` repeats → patient counts
   over-count) as the grain fixture.
3. Remaining **fix-prompt P0s** (Haiku 400, false chi-square note, constant-group t-test NaN — use
   datasets NEW-6's constant columns as the fixture).
4. **accuracy-ux A3 (Level 1) + A4 + A5**, then **B1–B5** (step wall, sample data, result
   visibility, undo, refresh guard).
5. **accuracy-ux A3 Level 2** (offline averages + group-by — the biggest capability win).
6. Remaining **fix-prompt P1/P2** and **accuracy-ux B6–B12**, folding in datasets NEW-3/5/7/8/9/10
   as real fixtures where they reinforce an item.

## Per-item workflow

For each item: read the finding → reproduce it (run the module or drop the relevant sample file in
the running app) → write a failing Vitest test → fix → confirm the test and the full suite pass →
keep app/Excel/(R) outputs in agreement → commit with a message naming the finding id. Slice small
(~15-row) fixtures from the `sample-data/` files into `test/fixtures/` rather than committing the
whole PHI-adjacent files or shipping them as the in-app demo.

## When you finish (or hit a stopping point)

Summarize what you applied (by finding id), the new test count, anything you deferred and why, and
leave the work on a branch off `phase/5-charts`. **Do not push.** Then write/refresh a short handoff
so the next session can resume.
