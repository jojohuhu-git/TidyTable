# Handoff — Offline-Smarts Plan: Phases 0–1 DONE, Phases 2–8 remaining (2026-07-10)

**Plan:** `.claude/prompts/plan-2026-07-10-offline-smarts.md` (committed to main).
**Start the next conversation with:** "Continue the TidyTable offline-smarts plan from
`docs/archive/handoff-2026-07-10-offline-smarts-phase1.md` — do Phase 3 next."

## What is DONE and on main (do not redo)

### Phase 0 — base landed
All four `revise/w1–w4` branches merged to main in dependency order (w1 → w3-which-carried-w2 → w4),
one small import conflict resolved, branches deleted, pushed. Main went 384 → 463 tests.

### Phase 1 — the three honesty bugs, fixed + verified live
All shipped in merge `956467c`, suite now **484 tests, all passing**. Logic + DOM layers both covered
(`src/logic/offline/honesty-2026-07-10.test.js`, `src/logic/charts/honesty-2026-07-10.test.js`,
`src/honesty-2026-07-10.dom.test.jsx` — these seed the Phase 6 "must never regress" bank).

1. **Average of a text column refuses** (`matcher.js`, `runOffline.js`).
   - Root cause was NOT "age ⊂ Diagnosis" as the plan guessed — it was the stray **"s" from
     "what's"** substring-matching "Diagnosi**s**". `fuzzyColumn` containment now requires 3+ chars
     on both sides.
   - New numeric gate in `matchAggregation`: average/sum on a column whose inferred type isn't
     `number`/`mixed (text + numbers)` declines with `"Diagnosis" contains words, not numbers — I
     can't average it.` (`reason: "non-numeric-target"`). Distinct counts are exempt.
   - The stale `UNSUPPORTED_LEAD` decline texts ("cannot compute averages yet" — false since A3 L2)
     were rewritten to the honest "couldn't tell which column".
2. **Step 9 "duration by diagnosis" no longer silently counts** (`textToChart.js`).
   - When no aggregation word was typed and leftover words name a NUMERIC column, the read flips to
     average-of-that-column with `confidence: "stretched"` → the existing confirm box asks before
     drawing. A leftover word naming a TEXT column ("drug by diagnosis") is reported via `ignored`
     instead of dropped.
3. **Negation supported, not dropped** (`matcher.js`, `cohort.js`, `fillPlan.js`).
   - `not / never / no / without / didn't / excluding / except / other than / apart from` invert the
     condition: value → op `<>`, set → `not-in`, and the answer line states it ("…where "Drug" is
     NOT amoxicillin"). Negation words that attach to nothing **block**.
   - Literal values win: the exact whole-phrase scan runs before negation, so a cell value like
     "No growth" still matches itself.
   - Per-patient grain: "never got X" = **no row** matches X (`positiveCondition` + `!some()`), not
     "some row isn't X". Verified live: example file, "did not get amoxicillin" per patient = 3 of 5.
   - "not/never/no + comparator" flips the op ("not more than 7" → at most 7) in the threshold path.
   - Cohort-marker fix: "patients with" required a word boundary — it used to match inside
     "patients with**out**" and invert the question.
   - Blank cells count as "not X" — deliberately matching Excel `COUNTIFS("<>X")` so the Excel steps
     reproduce the app's number. All three inline worker-transform copies in `fillPlan.js` mirror
     the new predicate semantics (tested by executing the generated code).

## Remaining phases — triage by model

| Next | Phase | Model | Why |
|---|---|---|---|
| 1st | **3 — everyday-word matching** | **Opus** | Biggest miss reduction. Layered heuristics with real false-positive risk against the never-guess promise; needs judgment about how far word-form folding may stretch, and the learned-alias store touches privacy/persistence design. |
| 2nd | **2 — descriptive stats + clinical formats** | **Sonnet** | Well-specified and mostly mechanical (median/IQR/SD math, n (%) / mean (SD) formatting, companion-chips). The plan already states the formats; the five-output parity (summary/Excel/transform) is patterned after existing aggregation code. Escalate to Opus if the unit-aware duration display gets ambiguous. |
| 3rd | **4 — most-common / top-N** | **Sonnet** | Small, self-contained new intent family; pure sort-and-rank mirroring the existing group-by machinery. |
| 4th | **5 — "no → better guess" refinement loop** | **Opus** | Interactive state machine over ranked candidate lists + generating discriminating questions; UX honesty judgment throughout. Needs Phase 3's candidate lists first. |
| 5th | **6 — self-teaching test bank + AI graduation** | **Fable to design, Sonnet to wire** | The template/slot expansion format, curation/export loop, and the learn-from-AI privacy boundary (plan shapes only, never cell values) deserve top-tier design; once the spec exists the storage + CI wiring is routine. |
| itemized | **7 — conversational/clinical extensions** | **Mixed** | Typo tolerance, number-words/units, denominator transparency → Sonnet. Cross-turn follow-ups, compound questions, Table-1 builder, grain memory → Opus (each ships alone). |
| last | **8 — chart "one brain" rebuild** | **Opus (Fable if hairy)** | Architectural: reroute Step 9 through the whole Step 3 pipeline without regressing the W4 chart surface; heavy regression risk, after Phases 3+5. |

Phase order stays the plan's: 3 → 2 → 4 → 5 → 6 → 7 (itemized) → 8. Ship each phase as its own
branch → merge → push (direct push to main is allowed on TidyTable).

## Small follow-ups noticed during Phase 1 (not blocking, good Sonnet warm-ups)

- **Chart shows 0 for a group with no readable numbers** — averaging Duration_days puts cystitis at
  0 when all its values are "N/A" (pre-existing, in `aggregate.js`). An honesty app should say "no
  readable numbers", not draw 0.
- **Unattached-negation block message** reads oddly: "how many patients did not" produces the
  missing-definition wording ('uses "how many patients did not", which the data does not define').
  A negation-specific message would be clearer.
- **Negated set Excel instruction** (a Definitions set + negation) reuses the generic "filter to the
  values that count" text — should say "values that do NOT count".
- **Negated blanks transparency**: blanks counting as "not X" is correct vs Excel but silent;
  Phase 7's "denominator + missing transparency" bullet is the natural place to state it.
- **Negated threshold at patient grain** still uses some(): "patients never over 7 days" reads as
  "has a row ≤ 7", not "no row > 7". Rare phrasing; fix alongside Phase 5 or 7 grain work.

## State checkpoints

- TidyTable main @ `956467c`+handoff commit, 484 tests green, deployed by push (GitHub Pages).
- No open branches; `feature/novice-audit-charts-eval` (old eval harness) remains unmerged by design.
- One stash exists on `feature/novice-audit-charts-eval` from earlier work — untouched.
