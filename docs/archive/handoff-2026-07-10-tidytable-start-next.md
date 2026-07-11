# TidyTable — Start-here handoff after Phase 5 shipped (2026-07-10)

**Repo:** `/Users/joannehuang/Downloads/TidyTable` · **Live:** https://jojohuhu-git.github.io/TidyTable/
**What TidyTable is:** a client-side, browser-only, plain-English spreadsheet-cleaning app
for a non-coder clinician. Core promise: **never guess, never silently drop or corrupt
data** — when it isn't sure, it asks; when it can't answer honestly offline, it says so.

Branch: **`main`**, working tree **clean**, in sync with `origin/main` at commit `568b533`
(pushed). **641 passing tests (98 files), all green.** GitHub Pages deploy for `568b533`
**succeeded** — the site is live. Nothing is in flight; this is a clean stopping point.

## What's done this session
Phase 5 of the offline-smarts plan (`.claude/prompts/plan-2026-07-10-offline-smarts.md`)
— the **"no → better guess" refinement loop** — designed, built, tested, merged, deployed.
Full implementation detail is in the companion handoff
`docs/archive/handoff-2026-07-10-offline-smarts-phase5.md` (not stale — accurate as of
`568b533`). One-paragraph summary:

- The Step 3 "Did you mean…?" confirm box gained a real **"None of these"**. It eliminates
  rejected guesses and asks a smarter next question — next-best candidates for a small
  remainder, or a plain-word discriminating question ("a length of time, the drug given,
  or the diagnosis?") for a large one. One survivor is still a confirm chip; all-rejected
  → honest decline + AI offer. >1-round exchanges are logged (column names only).
- New `src/logic/offline/refine.js` (pure loop), `conceptOfHeader()` in `concepts.js`,
  `allCandidates` sibling field in `matcher.js` (existing `candidates` unchanged;
  `cleanCondition` strips it), `logRefinement()` in `missLog.js`, App/ClarifyBox wiring.
- Commits: `a7a7680` (Phase 5), `568b533` (merge). Tests 621 → **641** (+20).
- Note: merge also carried `9080896`, an unrelated housekeeping commit that archived 12
  finished prompt/handoff files into `docs/archive` (benign, matches root-hygiene rule).

## What's NOT done — the remaining queue
The offline-smarts plan has these phases left, in build order (see the plan file for full
scope). None are started.
- **Phase 6** — self-teaching test bank + AI graduation (template phrase bank in CI;
  confirmed successes and AI-answered plan shapes saved locally so the offline engine
  learns; plan shapes only, never cell values). Natural follow-on to Phase 5.
- **Phase 7** — Step 3 conversational/clinical extensions (cross-turn "of those"
  follow-ups, typo chips, number-words/units, compound questions, Table-1 builder,
  denominator transparency, grain memory, show-the-rows, teach-it form). Itemized —
  each bullet ships alone.
- **Phase 8** — Step 9 chart intelligence: route chart requests through the SAME Step 3
  pipeline ("one brain, two steps"), chart-this chip, type inference said out loud, etc.
  Do this **after** Phase 5 (done) + Phase 3 (done), which it depends on.

Deferred by owner (not now): date/time questions; missing/blank-value questions.

## ⚠️ Open decision the owner must resolve first (ask, don't default)
The owner said **"will do Phase 4 after 5."** But the plan's **Phase 4 (most-common /
top-N ranking) is already shipped and merged** (`2137e82`, see
`handoff-2026-07-10-offline-smarts-phase4.md`). So "Phase 4" must mean a **different
track** — possibly the declunk workstream or another plan. **Do not assume.** Ask the
owner which "Phase 4" they mean. If they actually meant "keep going on the offline-smarts
plan," the next unbuilt phase is **Phase 6**.

## Resuming
1. `cd /Users/joannehuang/Downloads/TidyTable && git checkout main && git pull`
2. Run `npx vitest run` — confirm **641 passing** before any new work.
3. Start the dev server first (owner's standing rule): `preview_start` with name
   **"TidyTable dev server"**, port 5175, config `.claude/launch.json`.
4. Resolve the open decision above with the owner.
5. Per-item workflow (repo rule): reproduce → write a failing test (synthetic fixture,
   never real patient data) → confirm it fails → fix minimally → **full suite green** →
   verify in the running app if UI-observable → commit named for the item.
   **Both test layers required** for any visible behavior: a logic test (node env) AND a
   DOM/UI test (happy-dom).
6. Ship policy (TidyTable): `main` is **not** branch-protected — direct push to `main` is
   allowed, and a push to `main` **auto-deploys** to GitHub Pages. Prior phases used a
   branch → `--no-ff` merge → push pattern; keep that so each phase is one reviewable unit.
7. Honesty invariants that must never regress: never a silent guess; the refinement pool
   only ever shrinks (no invented candidates); nothing persisted to localStorage may
   contain a cell value (column names only). Tests enforce all three.
