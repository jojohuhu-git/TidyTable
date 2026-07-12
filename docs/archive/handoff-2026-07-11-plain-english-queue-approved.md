> **SUPERSEDED (2026-07-11).** Execution has begun. See
> `docs/archive/handoff-2026-07-11-p0-done-p1-1-list-done.md` for current state:
> P0-1…P0-4 and P1-1 (list+sort) are done, committed, and green (777 tests).
> The fix spec `.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`
> remains the active queue; resume at P1-1b / P1-2.

# TidyTable — Handoff after steps 2/3/9 review; approved fix queue, nothing executed (2026-07-11)

Branch: `main`, in sync with `origin/main` at `6cfec7e`. Nothing committed this
session; the only change is one new untracked file (the fix spec below).
Baseline verified this session: **761 passing tests (126 files), all green**.

Repo: `~/Downloads/TidyTable` · live at https://jojohuhu-git.github.io/TidyTable/
Core promise that constrains all work: never guess, never silently drop data.
The folder is cloud-synced — commit locally often or work can silently revert.

## What's done

1. **Review only — no app code changed.** A hands-on review of Steps 2, 3, 9
   (live app + logic-layer node repros) produced a full fix spec:
   **`.claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md`** (untracked;
   the next session should commit it first).
2. **Owner approved EVERYTHING on 2026-07-11** ("yes to all"): decisions A–E,
   all P4 items, the P5 publication workstream including two lazy-loaded MIT
   deps (pptxgenjs, docx), and — in a later message the same day — the **P6
   complex-graphics workstream** (stacked/grouped/100%-stacked bars,
   histograms, box+dot plots, Pareto, small multiples). Note: P6 REVISED
   original Decision C — two-variable charts are now in scope; P3-2's honest
   decline is only the interim state until P6-1 lands. No open decisions
   remain; the spec's DECISIONS section records each resolution.
3. Key verified findings (repro table R1–R8 in the spec, with exact wording):
   - "show me all / list all …" is mistaken for an undefined clinical term.
   - The teach form ("Remember this and ask again") is offered for declines
     teaching can never fix (e.g. sort) → infinite loop; memory itself works.
   - "average duration for UTI" wrongly declines (cohort + fuzzy target bug).
   - Step 9: plurals never match columns — `valueMatch.js` imports `foldWord`
     but deliberately doesn't use it (`void foldWord`).
   - Step 9: "compare drug use between diagnoses" silently drops half the
     request and claims "exact".

## What's NOT done — the remaining queue

Everything. Execute the spec top to bottom by its own **Execution order**
section: P0-1…P0-4 → P1-1…P1-4 → P2-1/2/4/3 → P3-1…P3-3 → P6-1/2/4/3/5 →
P5-1/2/3/6 → P4-1/2/6/4 → P5-4 (delivers P4-5)/P5-5 → P4-3. Item scopes,
repro fixtures, and acceptance notes are all in the spec — do not re-derive
them. The owner's acceptance sentence for the chart work: "of patients
diagnosed with cystitis, highlight the most common antibiotics prescribed or
durations chosen" — part (a) lands at P3-3, part (b) at P6-2/P6-4.

## Why this is a good stopping point

The review is a complete unit: every finding is reproduced, written up with
its root-cause file, and every design decision is already resolved by the
owner. The next session can go straight to test-first execution with zero
investigation and zero questions outstanding.

## Resuming

1. `cd ~/Downloads/TidyTable` — stay on `main` for now; create a working
   branch if preferred (repo allows direct commits to main, but never push
   without the owner's explicit go-ahead).
2. Run `npx vitest run` — confirm **761 passing (126 files)** before any work.
3. Commit the spec file first so the queue itself can't be lost to cloud sync.
4. Follow the fix-queue skill per item: reproduce (fixtures R1–R8) → failing
   test → minimal fix → full suite green → live-verify in the browser
   (`preview_start`, name "TidyTable dev server") → commit named by item ID.
5. Surfaces rule: Step-3 changes verified in result table + Excel recipe +
   R script; chart changes also in preview + Excel chart steps + aria summary
   + every export path. Load the dataviz skill before P3-3/P5 styling work.
6. PRIVACY: never read the owner's real files (e.g. "Copy of DC antibiotics
   test file.xlsx" in ~/Downloads) — synthetic fixtures only; owner declined
   file access on 2026-07-11.
7. Push/deploy only when the owner says so; pushing `main` publishes the live
   site.
