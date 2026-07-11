# Build the TidyTable Clinical Data Workbench

**Model to use: Claude Opus 4.8 (or better) for Phases 0–3 — architecture, the checkup engine, recipe replay, and the matcher are the parts that are hard to change later. Sonnet 5 is acceptable for Phases 4–5 template/content authoring once the engine exists and tests pass. If running the whole build in one conversation, use Opus 4.8.**

This prompt is self-contained and **supersedes** `.claude/prompts/build-offline-formula-engine.md` (kept for reference; its matcher/confidence/plan-plumbing ideas survive here, its template list and phase order do not). Read this prompt fully before writing code.

---

## 1. What TidyTable is today (read the code to confirm, don't trust this summary blindly)

TidyTable is a fully client-side React + Vite app (no backend, no build-time secrets). The user uploads an Excel workbook, types a plain-English request, and the app calls the Claude API (user's own key, from localStorage) which returns a schema-enforced JSON plan. Key files:

- `src/logic/schema.js` — `PLAN_SCHEMA`, the JSON shape of every plan: `clarifying_question`, `summary`, `summary_parts` (`looked_for` / `included` / `left_out` / `assumptions`), `transform_code` (body of a JS function receiving `sheets`), `excel_steps` (array of `{title, where, formula, translation, instruction, teaches}`), `r_script`, `r_run_notes`, `chart_suggestions`.
- `src/logic/claude.js` — builds the data context (`buildDataContext`: per-sheet headers with Excel column letters, inferred types, **real sample values — this is a privacy problem, see §5**) and calls the API. Its `SYSTEM_PROMPT` contains a banned-jargon word list and a beginner-teaching contract. That contract applies to ALL user-visible text everything in this prompt produces.
- `src/logic/runTransform.js` — executes `transform_code` via `new Function("sheets", code)(sheets)` in a sandboxed Web Worker, 30s timeout. `sheets` is `{ [sheetName]: arrayOfRowObjects }`, row keys = exact header names, values `string | number | boolean | null`, dates as strings like `"2024-03-15"`.
- `src/logic/workbook.js` — parses the uploaded file (SheetJS). `src/logic/letters.js` — column letters.
- `src/components/` — `UploadPanel`, `PromptPanel`, `ResultsPanel`, `ClarifyBox` (one-round-trip clarifying question — reuse it everywhere a module needs to ask something), `DataTable`, `ChartsPanel`, `FormulaPrimer`, `RstudioGuide`, `ApiKeyPanel`.
- `eval/` — `cases/`, `workbooks/`, `out/`, `run-evals.mjs`. Use and extend it.
- **No test runner yet.** Set up Vitest first (node env for logic; happy-dom is already a devDependency for component tests). Add `"test": "vitest run"`.

Dev server: `npm run dev` → http://localhost:5175. Deploys to GitHub Pages on push to `main`.

## 2. The mission

TidyTable's owner is a clinician (antimicrobial stewardship) with **no data analyst, epidemiologist, or statistician** and users may have **no AI subscription**. Rebuild TidyTable as a clinical data workbench where the entire monthly workflow — clean, replay, deidentify, count, test, chart — **runs offline with no API key**. The Claude API becomes an optional escape hatch for novel free-form requests only.

Six goals, in the owner's words (paraphrased):

1. **Monthly replay:** clean a recurring monthly export by recording the cleaning steps once, then replaying them on next month's file — including generating **deidentified prescribing report cards** even though the people in the data change month to month.
2. **Checkup:** on upload, automatically find everything that would hurt an analysis (duplicates, missing values, numbers stored as text, mixed date formats, category spelling variants, impossible values) and let the user pick what gets fixed.
3. **Cohort questions:** answer nested filtered questions like "of patients with pyelonephritis, how many received an oral beta-lactam, and of those, how many had excess durations" — where the user supplies the clinical definitions and the app makes clear that definitions must be provided.
4. **R for novices:** generate complete RStudio scripts for someone who has never used R, on Windows or Mac, with no packages installed and no AI subscription.
5. **Statistics:** run simple tests (chi-square, Fisher's exact, t-test) in the browser, showing all work so the user knows where every number came from (reference model: OpenEpi, https://openepi.com). For complex stats (multivariable regression, LASSO), generate R scripts — but only after an appropriateness check.
6. **Charts:** recommend the chart that best illustrates a result, preview it in-app, and give numbered instructions to reproduce it in Excel.

## 3. Decisions already made by the owner — do not re-litigate

1. **Record-and-replay, never infer-by-example.** Goal 1 is implemented by recording the user's interactive cleaning steps into a recipe and replaying it. Do NOT build anything that deduces transformations by comparing an input/output example pair — that class of system guesses silently and is banned.
2. **Refuse, never guess, on clinical vocabulary.** If a request uses a term that is not a column name, not a value present in the data, and not in the user's Definitions sheet, the app blocks with a plain message telling the user to add it to the Definitions sheet. No best guesses on drug classes, thresholds, or "what counts as excess." The app never hardcodes clinical knowledge.
3. **Offline-first.** Every request tries the offline engine before the API. High confidence → no API call. Low confidence → show the closest offline match plus a "use Claude instead" button. No key set → the app is fully usable offline; only the Claude path is gated on the key.
4. **Privacy mode is mandatory** before any AI call touches clinical files (§5).
5. **Smartness level: slot-filling templates + curated recipes.** No free-form natural-language query grammar. Anything the engine can't confidently match goes to Claude (with permission) or is declined plainly.
6. **UX rules (owner's explicit requirements, §4):** no serif fonts, no icons or emoji anywhere, one restrained color scheme, per-section instructions for a brand-new user.
7. **Excel dialect:** classic-primary (COUNTIFS/SUMIFS/INDEX-MATCH era) with 365 variants (FILTER/GROUPBY) as a labeled alternative where they differ. Display order stays a one-line config.
8. **Stats teaching model is OpenEpi:** show the work, show multiple components of the answer (table, expected counts, statistic, p, effect size + CI), invite independent verification.

## 4. UX redesign (Phase 0 — do this first, it touches every later screen)

The owner reviewed the current UI and rejected parts of it. Requirements:

- **No serif fonts anywhere.** The masthead currently uses `Georgia, "Times New Roman", serif` (`.masthead h1` in `src/styles.css`) — replace with the body's sans-serif stack. One type family for the whole app; create hierarchy with size and weight only. The monospace stack stays for formulas/code.
- **No icons, no emoji, no decorative glyphs.** Remove the existing ones: `✓` in `ApiKeyPanel.jsx` and `ResultsPanel.jsx` (use the words "Saved" / "Copied"), `💡` in `ResultsPanel.jsx`. Replace the circular `.step-num` badges with plain text headings ("Step 1 — Upload your spreadsheet"). Never add icon libraries, emoji, gradients, or mascot-style illustration. Status is conveyed with words and color, not symbols. Grep for emoji ranges before calling this done.
- **Color:** keep the existing restrained token palette (warm paper background, single teal accent `--accent`, semantic warn/error tones) — it already meets the owner's "clean, not overwhelming" bar. Rules going forward: exactly one accent color; neutrals for everything else; warn/error colors only for genuine warnings/errors; all colors via CSS custom properties, no hex literals in JSX.
- **Instructions in every section.** Each section/card opens with one or two plain sentences telling a first-time user what to do here and what will happen ("Drop your Excel file here. Nothing is uploaded anywhere — the file stays on this computer."). Every empty state says what will appear there once there's something to show. A brand-new user must be able to complete the whole workflow without any outside help. Write these in the same jargon-free voice as everything else.
- **Tone:** sentence case everywhere, no exclamation marks, no marketing language. This is a clinical tool; it should read like one.
- Keep the existing three-dismiss-path behavior for any popover (button, backdrop click, Escape).

## 5. Privacy mode (small, mandatory, before the AI path is used on real data)

`buildDataContext` currently sends **real sample cell values** to the API. For clinical files that can include names, MRNs, and dates of birth. Change it:

- Send column headers, letters, and inferred types as today, but replace sample values with **synthetic look-alikes** (same shape and type, fabricated content: a real date column shows fake dates in the same format; a text column shows strings of similar length/pattern; never actual cell contents).
- Show a permanent, quiet indicator when working offline: "Your data has not left this computer." When a Claude call is about to happen, say plainly what will be sent (column names and made-up examples only) before sending.
- Tag offline-produced plans with a non-schema field `engine: "offline"` so the UI can label results "answered offline" and adjust the R tab.

## 6. Module A — Checkup engine (goal 2; the foundation everything else stands on)

`src/logic/checkup/`. On upload, run a deterministic scan — no AI — and render a findings checklist. Each finding: what was found, how many rows/cells affected, a sample of affected values, and a fix button. **Nothing is ever fixed without the user choosing it.** Findings to detect:

1. Duplicate rows, and duplicate values in ID-like columns (a column that is nearly-unique is probably an ID; if it has repeats, say which values repeat).
2. Missing values per column, including sentinel blanks (`N/A`, `n/a`, `-`, `none`, empty string, `.`).
3. Numbers stored as text (`" 5 "`, `"$1,200"`, `"1,204"`), with count and samples.
4. Mixed or text date formats in date-like columns.
5. Category spelling variants that case/space-fold together (`West`/`west `/`WEST`; `M`/`Male`/`male`) — propose the merge, show what merges into what.
6. Impossible values: negative values in never-negative columns, ages > 120, dates in the future, end-before-start where two date columns look paired. Keep the rules simple and visible; let the user dismiss any finding.
7. Censored lab values (`"<0.5"`, `">1000"`) and text like `"pending"` in numeric columns — the fix asks a policy question via ClarifyBox (treat as the boundary number, treat as missing, or leave and exclude), and records the answer.
8. Multi-value cells (`"red, blue"`) in columns being grouped/counted.

Each accepted fix emits a `PLAN_SCHEMA`-shaped plan (so the existing worker/results pipeline applies it) AND appends a step to the session's recipe (§7) AND appends to the cleaning log (§7). Fixes reuse shared normalizer functions (`src/logic/checkup/normalizers.js`): `coerceNumbers`, `trimCase`, `sentinelBlanks`, `parseDates`, `splitList`, `censoredValues`. Each normalizer exists in BOTH forms: a JS pass inside the generated transform, and an Excel helper-column step spliced into `excel_steps` so the recipe stays honest ("in H2 enter `=TRIM(B2)`; the COUNTIFS then points at column H").

**Permanently out of scope:** mixed units in one column ("5 kg" vs "5000 g"). Detect and say plainly that this needs human judgment (or the AI mode); never auto-fix.

## 7. Module B — Recipes, replay, report cards (goal 1)

`src/logic/recipes/`.

**Recording.** Every applied action (checkup fix, cohort question marked "include in monthly report", deidentification, chart) appends a step to the current recipe. Steps reference columns **by header name** (fuzzy-matched on replay: case/space/punctuation-insensitive), never by position. Recipes serialize to JSON: saved in localStorage AND exportable/importable as a file (the owner works across synced machines).

**Replay.** User uploads next month's file, picks a saved recipe, hits run. Replay MUST end with a plain-language report:
- steps applied cleanly, with row counts at each step (started 340 rows → after duplicate removal 328 → …);
- **surprises, loudly:** new category values no rule covers, a column that no longer fuzzy-matches, new people (see key file), rows a rule couldn't handle. Each surprise either asks via ClarifyBox or is flagged in the output — a replay never silently guesses and never silently drops data.

**Cleaning log.** Cumulative, exportable, plain-English record across the whole session/replay: what was changed, why, row counts before/after, which rows were dropped (listed or downloadable). This is the user's defensibility trail for bosses, QI committees, and reviewers. Build it once here; every module writes to it.

**Deidentification key file.** A local-only mapping (name → stable code, e.g. `Dr. Smith → Prescriber 07`), stored separately from recipes and reports, exportable/importable like recipes. On replay, new people get the next unused code automatically and the replay report says so ("2 new prescribers, assigned codes 14 and 15"). Codes are stable across months so trends are trackable. **The key must be physically incapable of appearing in report output** — the report generator takes the already-coded table, never the key.

**Report cards.** A recipe's terminal step can be "generate report cards": one output sheet/section per person, showing that person's own row(s) by name and all peers as codes (peer bars gray, own bar in the accent color — this convention is also the chart default, §11). Include a **small-cell warning**: any displayed group of 1–2 people gets flagged as re-identifiable even without names, with a suggestion to pool or suppress.

## 8. Module C — Offline matcher + cohort questions (goal 3)

`src/logic/offline/` — this is where the prior handoff's good bones live:

- `entries/` — one file per template entry / shelf recipe, human-editable, no build step.
- `synonyms.js` — shared synonym dictionary (~200 terms): total/sum/add up → SUM; how many/count/number of → COUNT; typical/average/mean → AVERAGE; comparison words ("at least/5 or more" → `>=`, "under/at most/or fewer" → `<=`/`<`, "is/exactly" → `=`, "not/except/excluding" → `<>`); each/per/by → group-by; out of/share/percent → proportion; different/unique/distinct → distinct.
- `matcher.js` — scores entries against the request, extracts slot fillers.
- `fillPlan.js` — matched entry + fillers + workbook schema → `PLAN_SCHEMA`-shaped plan.
- `missLog.js` — localStorage miss logging with an unobtrusive export button (the growth loop: the owner reviews misses and adds entries/synonyms).

**Entry format** (design carefully — everything depends on it): `id`, `name` (plain English), `triggers` (resolved through synonyms), `slots` (target column(s); a LIST of conditions — column/comparator/value, unlimited pairs; optional group-by; optional `distinct`; optional `topN`), `mode` (`"row"` or `"group-then-test"`), `normalizers` (which cleaning pre-passes to offer), `excel` (classic recipe + 365 variant as placeholder templates filled with real column letters/headers/ranges; every emitted `excel_steps` item satisfies the same contract as the Claude path — exact cell, exact fill range, literal formula, one-sentence translation, `teaches` on first use), `transform` (code-generated `transform_code` body from a template string — keeps the worker contract unchanged), `example` (tiny worked example: input rows, phrasing, expected output — shown in UI AND run as an automatic test), `r` (optional R snippet template where trivial).

**Matcher confidence — the honesty layer, non-negotiable.** Three states: **Confident** → produce and run the plan, but ALWAYS render what was understood via `summary_parts.looked_for` ("Counting rows where **Diagnosis** is pyelonephritis AND **Route** is oral") so a wrong guess is visible before anyone trusts the number. **Unsure** → offer the closest match: "I think you want: [description]. Use this, or ask Claude?" **No match** → offer Claude if a key exists; otherwise say plainly this request needs the AI mode; log the miss either way. Tune thresholds against eval cases, not by feel.

**Slot filling:** intent from triggers; columns fuzzy-matched against real headers ("sales" ≈ "Sales_2024"); **value scan** — a request word matching no header but found in a column's VALUES ("pyelonephritis" in a Diagnosis column) becomes a condition (headline feature, test it well); comparators from comparison words; proportion phrasing emits both the count and count/denominator.

**Grain detection** (prevents the worst silent-wrong-answer class): before answering anything phrased per-entity ("how many patients…"), check whether the entity column repeats in the real data. If it does and the entry is row-mode, don't answer — raise a `clarifying_question` through ClarifyBox ("Each patient appears on several rows — should I combine their rows first, then check who meets the condition?"); yes → `group-then-test`.

**Definitions sheet (the clinical-knowledge gate).** A workbook tab (app can create it) with columns like `term | column it applies to | values that count` (e.g. `oral beta-lactam | Drug | cephalexin, amoxicillin, amox-clavulanate, cefpodoxime`) and threshold rules (`excess duration | Duration_days | > 7 when Diagnosis = pyelonephritis`). The matcher consults it after headers and value-scan. A term found nowhere → block with: "I don't know what counts as an oral beta-lactam. Add it to the Definitions sheet and ask again." The Definitions sheet lives in the workbook, so every report documents its own criteria. Nested questions ("of X, how many Y; of those, how many Z") are chained filters over these definitions — support at least two levels of "of those" with counts and proportions at each level.

**Recipe shelf** (curated multi-step recipes, same entry shape): remove duplicates → subtotal by group; rows in sheet A missing from sheet B (anti-join); look up each row's value from another sheet by ID (left join — this powers the drug→class dictionary); explode paired list cells (validate equal item counts per row; on mismatch, stop and show the offending rows — never guess pairing); match each event to the most recent prior event per person (as-of join; flag, never drop, events with no valid match); count per group + "who has the most"; reshape one-row-per-visit ↔ one-row-per-patient.

**Chained steps:** an applied offline result becomes the working table for the next command ("apply and continue"), so multi-stage pipelines are driven one plain command at a time — and every applied step is recordable into the recipe (§7).

**Claude fallback:** when the user chooses Claude after a partial match, append the engine's partial read as a hint to the user message ("A local pre-check suggests: SUM-family on column Duration, condition unclear"). Only ever with privacy mode's synthetic context (§5).

## 9. Module D — Statistics (goal 5)

`src/logic/stats/`. Reference model: OpenEpi (https://openepi.com) — open-source browser epi calculators; copy its habit of showing the work and multiple methods, not its UI.

**In-browser tests (no API, no R):** chi-square (2×2 and R×C), Fisher's exact (2×2), two-sample t-test, and confidence intervals for proportions and for OR/RR. Implement with well-known formulas; unit-test against published worked examples and OpenEpi outputs.

**Show-the-work contract — every test renders, in order:**
1. The table the app built from the data, with row/column labels and totals (most wrong p-values come from a wrongly built table — the user must be able to see it's right).
2. Expected counts (for chi-square-family).
3. The test-choice rule, stated plainly: "One expected count is below 5, so Fisher's exact test is used instead of chi-square, which would be unreliable here." Auto-switch to Fisher when the rule fires.
4. The test statistic, degrees of freedom, and p-value.
5. The effect size with a 95% confidence interval (OR or RR for 2×2; difference in means for t-test) — a p-value alone is a half-answer.
6. A verification invitation: "Check this yourself at OpenEpi" with the four cell values displayed for retyping.

**Language rule:** never causal wording. "Associated with," never "caused by." No exceptions in any generated text.

**Complex-stats gate (the appropriateness double-check the owner requires).** Before generating any regression/LASSO script, a three-question wizard: (a) What is your outcome? (yes/no → logistic; a measurement → linear; time-until-event → survival); (b) Are the same patients measured more than once / matched? (c) How many patients had the outcome, and how many predictor variables? Then compute the events-per-variable check from the actual data: fewer than ~10 outcome events per predictor → refuse with a plain explanation ("38 patients had the outcome and you listed 9 variables; that model would be unstable. Pick your 3 most important variables or collect more data.") The wizard either recommends the right method or declines — it never generates a script it just argued against. Every complex-stats output ships with a short plain-English "before you trust this" checklist and one honest line: this is the area where this app substitutes for software, not for a statistician.

## 10. Module E — R script generator (goal 4)

`src/logic/rscripts/`. Deterministic templates filled with the user's real column and sheet names — no AI required. Every generated script follows this contract:

- **Console-only instructions.** Never reference RStudio menus, panes-by-position, or buttons — they change between versions and the app cannot track RStudio updates. "Paste this into the Console (the pane showing a `>` symbol) and press Enter" is the entire interaction model. Include the escape-hatch line: "If anything on your screen looks different from these instructions, the Console method always works."
- **Self-installing:** guarded installs (`if (!require("readxl")) install.packages("readxl")` pattern) so a fresh machine with zero packages works.
- **No file paths ever:** `file.choose()` so R opens the standard file picker — identical experience on Windows and Mac.
- **Dual keystrokes inline** wherever one is needed: "press Ctrl+Enter (Windows) or Cmd+Enter (Mac)."
- **Labeled output + expected-output block:** the script prints results with plain-English labels, and the accompanying notes include "You should see something like:" with a realistic mock so a novice can tell success from garbage.
- Plain-English comment above every step in the script itself.

Provide templates for: reading their workbook, each simple stat in §9 (as the R cross-check), each complex method the wizard can approve (logistic/linear regression, LASSO via glmnet, basic survival), and the cleaning operations where an R version is trivial (dplyr one-liners). `r_script`/`r_run_notes` fields in offline plans use these templates; where none exists, fill honestly: "The R script is available for this task when using the AI mode; the app result and Excel recipe above fully reproduce this answer."

## 11. Module F — Chart advisor (goal 6)

Extend `chart_suggestions` + `ChartsPanel`:

- **Opinionated, not a menu.** From the result's shape, pick ONE recommended chart (alternatives collapsed behind "other options"): categories compared → bar; change over time → line; two numeric variables → scatter; part-of-whole with ≤4 slices → pie allowed, otherwise bar with a one-line reason ("a 9-slice pie is unreadable — bars show this better").
- **Preview in-app** (extend `chartPreview.js`), rendered under the same no-icon, one-accent design rules. Report-card idiom is the default for peer comparisons: the subject's bar in the accent color, all peers gray.
- **Excel reproduction steps with every chart:** numbered, starting from exactly which cells to select, then Insert → chart type, then only the 2–3 formatting moves that matter (title, axis labels, sort order). Lean on the Excel interface parts that have been stable for 15 years (select range → Insert tab → chart button); note "Excel on Windows / Excel on Mac" only where they genuinely differ; skip cosmetic steps whose menus move between versions.

## 12. Plan-shape and language rules (all modules)

- Every offline-produced plan emits every `PLAN_SCHEMA` field, plus non-schema `engine: "offline"`.
- `summary_parts` is the trust panel — fill all four fields genuinely (matched, kept, excluded, assumed — including every normalizer action and fuzzy column match).
- **Banned-word rule:** all user-visible text (summaries, steps, translations, clarifying questions, findings, wizard questions, chart reasons, R notes) follows the no-jargon contract in `claude.js`'s system prompt — no "string/array/parse/null/boolean/token/schema/JSON/regex/…". Excel function names and R function names are fine and encouraged.
- All user-visible text at a plain, everyday reading level. The owner requires jargon-free explanations everywhere.

## 13. Testing & the growth loop

- Vitest from Phase 0. Every entry's `example` runs automatically as a test (generate transform → run on example rows → compare). Matcher tests: (phrasing → expected entry + fillers) cases including near-misses that must NOT match confidently. Checkup tests: small fixture workbooks per finding type. Stats tests: published worked examples + OpenEpi cross-checks. Recipe tests: record on file A, replay on file B with a renamed column, a new category value, and new people — assert the surprise report catches all three.
- Wire the existing `eval/` folder: logged misses and the acceptance scenarios below become eval case files under `eval/cases/`.

### Acceptance scenarios (all must pass before calling the relevant phase done)

1. Upload a messy fixture (duplicates + text-numbers + `M/Male/male` + one `"<0.5"`) → checkup lists all findings with counts and samples; applying three fixes produces correct data, an honest cleaning log, and Excel helper-column steps.
2. Record a recipe on month-1 fixture (dedupe → merge categories → swap names for codes → report cards); replay on month-2 fixture containing 2 new prescribers, 1 new spelling variant, and a renamed column → replay report announces all three surprises; new prescribers get new stable codes; no report output contains a real name; a group of size 1 triggers the small-cell warning.
3. "Of patients with pyelonephritis, how many received an oral beta lactam, and of those, how many had excess durations" — with no Definitions sheet: app blocks and asks for definitions. With the Definitions sheet filled: correct nested counts + proportions, `looked_for` shows exactly what was counted, works with zero API key.
4. Patients repeating across rows on scenario-3 data → grain check fires ClarifyBox → group-then-test gives the per-patient answer.
5. A 2×2 stats question → rendered table with totals, expected counts shown, auto-switch to Fisher when an expected count < 5 with the reason stated, OR with CI, OpenEpi cross-check line. Same analysis's R script runs on a fresh R install (verify the guarded-install + `file.choose()` script actually runs in R on at least one platform).
6. Regression wizard with 38 events and 9 predictors → refuses with the plain explanation; with 3 predictors → generates the logistic script with the "before you trust this" checklist.
7. Gibberish / clearly-AI-territory request with no API key → declines gracefully in plain words, logs the miss. NO confident wrong answer anywhere.
8. Grep the built app for emoji and serif font-families → zero hits. A first-time user reading only on-screen text can complete upload → checkup → fix → download.

## 14. Phases (each ships usable on its own)

- **Phase 0 — UX + rails:** Vitest setup; UX redesign per §4 (serif removal, icon/emoji removal, step-badge replacement, per-section instructions, empty states); privacy-mode context change + offline badge (§5); PromptPanel no longer hard-requires an API key. Scenario 8.
- **Phase 1 — Checkup:** findings scan, pick-your-fixes checklist, normalizers with Excel helper-column splicing, cleaning log v1. Scenario 1.
- **Phase 2 — Recipes & report cards:** recording, replay with surprise report, recipe export/import, key file, report-card generation, small-cell warning. Scenario 2.
- **Phase 3 — Matcher & cohort questions:** entry format, synonyms, matcher with three confidence states, slot filling (fuzzy columns, value scan, comparators, proportion), grain detection, Definitions sheet + refuse-don't-guess gate, nested "of those" chains, chained-steps mode, miss logging, Claude fallback hint. Scenarios 3, 4, 7.
- **Phase 4 — Stats & R:** in-browser chi-square/Fisher/t-test/CIs with the show-work contract; complex-stats wizard + events-per-variable gate; R script generator + templates. Scenarios 5, 6.
- **Phase 5 — Charts & shelf completion:** chart advisor + Excel reproduction steps; recipe shelf completion (anti-join, left-join lookup, explode, as-of join, reshape); 365 formula variants complete.

## 15. Non-goals — do not build these

- Inferring transformations from input/output example pairs (banned, §3.1).
- Hardcoded clinical knowledge of any kind — drug classes, duration thresholds, diagnosis groupings. Always the Definitions sheet.
- A free-form natural-language query grammar (Level 3 composition).
- Parsing long multi-stage paragraphs offline — chained steps is the offline answer; paragraphs are Claude's job.
- Mixed-unit reconciliation (detect + say so only).
- Causal-language conclusions from any statistical output.
- Any server, any bundled ML model, anything that breaks "fully client-side, works offline."
- Icons, emoji, icon fonts, serif display faces, gradients — permanently.

## 16. Working style

- Branch per phase, small commits. Ask once at the start whether to push/PR to `main` or stay local.
- When a decision here conflicts with what you find in the code, say so and propose the fix — don't silently pick one.
- All user-visible text at a plain, everyday reading level, jargon-free, sentence case, no exclamation marks.
