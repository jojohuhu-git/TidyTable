# Build the TidyTable Offline Formula Engine

> **SUPERSEDED (2026-07-05):** do not build from this prompt. The project was reframed as a clinical data workbench — use `.claude/prompts/build-clinical-workbench.md` instead. This file is kept for reference only.

**Model to use: Claude Opus 4.8 for Phases 1 and 2 (architecture, matcher, confidence logic — the parts that are hard to change later). Sonnet 5 is acceptable for Phase 3 template/recipe authoring once the engine exists and tests pass. If running the whole build in one conversation, use Opus 4.8.**

This prompt is self-contained. Read it fully before writing code.

---

## 1. What TidyTable is (read the code to confirm, don't trust this summary blindly)

TidyTable is a fully client-side React + Vite app (no backend). The user uploads an Excel workbook, types a plain-English request, and the app calls the Claude API (user's own key, from localStorage) which returns a **schema-enforced JSON plan**. Key files:

- `src/logic/schema.js` — `PLAN_SCHEMA`, the JSON shape of every plan: `clarifying_question`, `summary`, `summary_parts` (`looked_for` / `included` / `left_out` / `assumptions`), `transform_code` (body of a JS function receiving `sheets`), `excel_steps` (array of `{title, where, formula, translation, instruction, teaches}`), `r_script`, `r_run_notes`, `chart_suggestions`.
- `src/logic/claude.js` — builds the data context (`buildDataContext`: per-sheet headers with Excel column letters, inferred types, sample values, row counts) and calls the API. Its `SYSTEM_PROMPT` contains a **banned-jargon word list** and a beginner-teaching contract for `excel_steps`. That contract applies to ALL user-visible text this engine produces too.
- `src/logic/runTransform.js` — executes `transform_code` via `new Function("sheets", code)(sheets)` in a sandboxed Web Worker with a 30s timeout. `sheets` is `{ [sheetName]: arrayOfRowObjects }`, row keys = exact header names, values `string | number | boolean | null`, dates as strings like `"2024-03-15"` or `"2024-03-15 09:30"`.
- `src/logic/workbook.js` — parses the uploaded file (SheetJS).
- `src/components/ClarifyBox.jsx` — existing UI for a one-round-trip clarifying question. Reuse it.
- `src/components/PromptPanel.jsx`, `ResultsPanel.jsx`, `ApiKeyPanel.jsx` — request entry, plan rendering, key management.
- `eval/` — existing folder with `cases/`, `workbooks/`, `out/`. Use it.
- **There is no test runner yet.** `package.json` has no `test` script. Set up Vitest (node environment for engine logic; happy-dom is already a devDependency for any component tests). Add a `"test": "vitest run"` script.

Dev server: `npm run dev` → http://localhost:5175. Deploys to GitHub Pages on push to `main`.

## 2. The mission

Build an **offline formula engine**: a second "plan writer" that lives entirely in the browser, requires no API key, and — when it recognizes a request — produces a plan object of the **exact same shape as `PLAN_SCHEMA`** and hands it to the exact same downstream pipeline (worker transform, results panel, downloads). TidyTable must not care who wrote the plan.

Core value: the user types plain English ("total sales for the west region"), the engine matches it to a fill-in-the-blank formula template, fills the blanks with the user's **real column names and values**, and returns a working plan — no API call, no cost, works fully offline.

## 3. Decisions already made by the project owner — do not re-litigate

1. **Output scope:** every database entry produces a formula recipe AND a JS `transform_code` implementation, so offline matches still transform the data live in-app. The R script is NOT required offline (see §7 for how to fill the schema field honestly).
2. **Integration:** offline-first. Every request tries the offline engine before the API. High confidence → no API call. Low confidence → show closest offline match + a "use Claude instead" button. No key set → offline engine is the only path, with a clear message when it can't help.
3. **Excel dialect:** each entry stores BOTH a classic-Excel formula recipe (COUNTIFS/SUMIFS/INDEX-MATCH era) and a modern-365 variant (FILTER/UNIQUE/GROUPBY/TEXTSPLIT) where they differ. ⚠️ **Display-order note:** the owner originally chose 365-primary, but the app's existing Claude system prompt deliberately teaches classic Excel first (365 only when unavoidable, with a classic fallback). For consistency with the app's teaching philosophy, default to **classic-primary with the 365 variant shown as an alternative**, and keep display order a one-line config change. Confirm with the owner if they feel strongly; do not block on it.
4. **Smartness level:** Level 2 — slot-filling templates (parse intent + parameters, fill with real column names) plus a curated **recipe shelf** of hand-authored multi-step recipes. NOT Level 3 (free-form composition / mini query language). Anything the engine can't confidently match goes to Claude.

## 4. Architecture requirements

Create `src/logic/offline/` containing roughly:

- `entries/` — one JSON (or JS) file per template entry and per shelf recipe. Human-editable, no build step.
- `synonyms.js` — shared synonym dictionary (~200 terms): "total/sum/add up/overall" → SUM; "how many/count/number of" → COUNT; "typical/average/mean" → AVERAGE; comparison words ("at least/5 or more/minimum of" → `>=`, "under/less than/below/at most/or fewer" → `<=`/`<`, "is/equals/exactly" → `=`, "not/except/excluding" → `<>`), "each/per/by/for every" → group-by signal, "out of/share/percent/what fraction" → proportion signal, "different/unique/distinct" → distinct signal.
- `matcher.js` — scores entries against the request; extracts slot fillers.
- `fillPlan.js` — takes a matched entry + fillers + workbook schema, emits a `PLAN_SCHEMA`-shaped plan.
- `normalizers.js` — shared cleaning pre-pass functions (§6).
- `missLog.js` — localStorage miss logging (§9).

### Entry format (design this carefully in Phase 1 — everything else depends on it)

Each template entry needs:

- `id`, `name` (plain English)
- `triggers`: phrases/keywords, resolved through the synonym dictionary
- `slots`: what blanks it needs — target column(s), a **LIST of conditions** (each: column, comparator, value; COUNTIFS/SUMIFS take unlimited pairs, so must the format), optional group-by column, optional `distinct` flag, optional `topN`
- `mode`: `"row"` (conditions test raw rows) or `"group-then-test"` (aggregate per group first, then test the aggregates — see grain detection, §5)
- `normalizers`: which cleaning pre-passes this entry wants offered (e.g. `["coerceNumbers", "trimCase"]`)
- `excel`: classic recipe steps + 365 variant, as **templates with placeholders** for real column letters, header names, and row ranges (the engine has these from `workbook.js` / `buildDataContext`'s header objects: `{letter, name, type, samples}`). Every emitted `excel_steps` item must satisfy the same contract as the Claude path: exact cell, exact fill range, literal formula with real references, one-sentence `translation`, `teaches` on first use of a mechanic.
- `transform`: a JS implementation (a function of `(sheets, fillers)` serialized or code-generated into a `transform_code` body — pick one approach and document it; code generation from a template string is fine and keeps the worker contract unchanged)
- `example`: a tiny worked example (input rows, request phrasing, expected output rows) — used in the UI AND as an automatic test case
- `r` (optional): an R snippet template; include where trivial (dplyr one-liners), omit otherwise

Shelf recipes are the same shape but with fixed multi-step logic and simpler slot needs.

### Matcher + confidence (the honesty layer — non-negotiable)

Every match gets a confidence score. Three UI states:

- **Confident:** produce the plan and run it, but ALWAYS render what was understood, using `summary_parts.looked_for` (e.g. "Counting rows where **Cars Sold** is 5 or more AND **Returns** is 10 or fewer"). A wrong guess must be visible before anyone trusts the number.
- **Unsure:** show the closest match as an offer — "I think you want: [description]. Use this, or ask Claude?" One tap each way.
- **No match:** go straight to Claude; if no API key, say plainly that this request needs the AI mode and log the miss.

Never silently guess. Tune thresholds against the eval cases (§9), not by feel.

### Slot filling

1. Intent from trigger words via the synonym dictionary.
2. Column references fuzzy-matched against real headers (case/space/punctuation-insensitive, substring and token overlap; "sales" ≈ "Sales_2024").
3. **Value scan:** if a request word matches no header but appears in the VALUES of some column (e.g. "west" in a Region column), that column+value becomes a condition. This is a headline feature — implement and test it well.
4. Comparators from comparison-word mapping ("5 or more" → `>=5`, "10 or less" → `<=10`).
5. "out of / what share / percent" → proportion: emit both the count and count/denominator as the result.

### Grain detection (prevents the worst silent-wrong-answer class)

Before answering anything phrased per-entity ("how many people…", "which customer…"), check whether the entity column has duplicate values in the real data. If it does and the entry is row-mode, do NOT answer directly — raise a `clarifying_question` through the existing ClarifyBox flow: "Each person appears on several rows — should I total their numbers first, then check who meets the condition?" If yes → switch to `group-then-test` mode. The offline engine may use `clarifying_question` exactly like Claude does (one round trip, then best-assumption).

## 5. Normalizers (cleaning pre-pass)

Small shared functions, each existing in BOTH forms: a JS pre-pass applied inside the generated transform, and an Excel helper-column step spliced into `excel_steps` (so the recipe stays honest: "in H2 enter `=TRIM(B2)` … the COUNTIFS then points at column H").

1. `coerceNumbers` — text-that-looks-numeric (`" 5 "`, `"$1,200"`, `"1,204"`) → numbers. If any coerced values are found in a target column, apply and report it.
2. `trimCase` — trim + case-fold text before category matching/grouping ("West"/"west "/"WEST" merge; report the merge).
3. `sentinelBlanks` — `N/A`, `n/a`, `-`, `none`, empty string → missing. When present in an AVERAGE-family target, ask via ClarifyBox: skip them or treat as zero.
4. `parseDates` — text dates / mixed formats → real dates before any by-month/by-year grouping.
5. `splitList` — multi-value cells (`"red, blue"`) → separate values (used by the explode recipes).
6. Data-quality report: whatever normalizers did gets summarized in `summary_parts.left_out` / `assumptions` in plain words ("merged 'west' and 'West'; converted 14 numbers that were stored as text").

**Out of scope, permanently for this engine:** mixed units in one column ("5 kg" vs "5000 g") — needs judgment; that's Claude's job. Say so if detected.

## 6. Coverage

**Phase 1 (10 core templates):** SUM, COUNT, AVERAGE, MIN, MAX — each plain and with a condition list (SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS); group-by subtotal (classic: UNIQUE-list-then-SUMIFS or pivot walkthrough; 365: GROUPBY); count distinct; proportion ("out of").

**Phase 3 target (~30 templates total), adding:** top/bottom N, percent of total, blanks/missing count, duplicate detection, running total, by-month/by-year grouping, min/max row lookup ("who sold the most" → INDEX/MATCH classic, XLOOKUP/FILTER 365).

**Recipe shelf (~12, Phase 3), must include:**
- remove duplicates → subtotal by group
- rows in sheet A missing from sheet B (anti-join)
- **explode paired lists:** two columns hold several values lumped per cell, paired by position (first date ↔ first order) → one row per item. MUST validate equal item counts per row; on mismatch, stop and show the offending row(s) — never guess pairing.
- **match to most recent prior event (as-of join):** e.g. assign each complaint datetime to the latest order datetime before it, per person. Flag (never drop) events with no valid earlier match.
- count per group + "who has the most" on the result

## 7. Plan-shape details for offline plans

- Emit every `PLAN_SCHEMA` field. For `r_script`/`r_run_notes` when no R template exists: a one-line honest note ("The R script is available when using the AI mode; the app result and Excel recipe above fully reproduce this answer."). Add a non-schema field like `engine: "offline"` on the plan object (it's constructed locally, not validated) so the UI can tag results "answered offline — no data left your computer" and hide/adjust the R tab.
- `summary_parts` is the trust panel — fill all four fields genuinely (what was matched, kept, excluded, assumed — including every normalizer action and the fuzzy column matches made).
- **Banned-word rule:** all user-visible text (summaries, steps, translations, clarifying questions, entry names) must follow the same no-jargon contract as the Claude system prompt in `claude.js` — no "string/array/parse/null/boolean/token/schema/JSON/regex/…". Excel function names are fine and encouraged.
- `chart_suggestions`: empty array is fine for Phase 1; add simple per-template suggestions later only where obvious (group totals → column chart).

## 8. Fallback integration

- When the engine is confident: no API call at all.
- When unsure or unmatched and the user chooses Claude: if the engine had a partial read ("SUM-family on column Sales, condition unclear"), append that hint to the user message sent to Claude ("A local pre-check suggests: …") — cheaper, faster, more accurate fallback.
- When no API key exists, the app should now be usable in offline-only form: PromptPanel must not hard-require a key anymore; gate only the Claude path on it.

## 9. Testing & the growth loop

- Set up Vitest. Every entry's `example` runs automatically as a test (generate transform → run on example rows → compare to expected output). Add matcher tests: a list of (phrasing → expected entry + fillers) cases, including near-misses that must NOT match confidently.
- Wire the existing `eval/` folder: each logged miss and each acceptance scenario below becomes an eval case file under `eval/cases/`.
- **Miss logging:** when the engine fails (or the user overrides its match), store the phrasing + timestamp in localStorage with an export button somewhere unobtrusive. This is the database's growth engine — the owner reviews misses and adds entries/synonyms.

### Acceptance scenarios (all must pass before calling a phase done)

1. "total sales for the west region" — value-scan finds "west" in a Region-like column → SUMIFS plan, correct number, recipe with real refs.
2. "out of all the people who sold 5 or more cars, how many had 10 or less returns" — one row per person: COUNTIFS with two conditions, PLUS the proportion offered. Same request when people repeat across rows: grain check fires ClarifyBox, then group-then-test.
3. Numbers stored as text in the target column: `coerceNumbers` fires, result correct, Excel recipe includes the helper column, trust panel reports the conversion.
4. "average score" with `N/A` values present: ClarifyBox asks skip-vs-zero.
5. (Phase 3) Chained: explode paired order/date lists → as-of join complaints to most recent prior order → "who has the most complaints". Mismatched list counts on one row halts with that row shown.
6. Gibberish / clearly-Claude-territory request: engine declines gracefully, offers Claude, logs the miss. NO confident wrong answer.

## 10. Phases (each ships usable on its own)

- **Phase 1:** Vitest setup; entry format (with condition lists, `mode`, normalizer hooks designed in NOW even if unused); synonym dictionary v1; 10 core templates; keyword/trigger matcher with the three confidence states; wire in front of the Claude call behind a settings toggle (default ON when no API key, otherwise owner's choice); acceptance scenarios 1–2 (single-row form) + 6.
- **Phase 2:** full slot filling (fuzzy columns, value scan, comparators, proportion); normalizers 1–4 with Excel helper-column splicing; grain detection + ClarifyBox reuse; confidence tuning against eval cases; scenarios 2 (grain form), 3, 4.
- **Phase 3:** recipe shelf (~12) incl. explode + as-of join; **chained-steps mode** — an offline result can become the working table for the next command ("apply and continue"), so multi-stage pipelines are driven one plain command at a time; miss logging + export; template count to ~30; 365 variants complete; scenario 5.

## 11. Non-goals — do not build these

- Level 3 free-form composition / a natural-language query grammar.
- Parsing long multi-stage paragraphs offline (that's Claude's job; chained steps is the offline answer).
- Mixed-unit reconciliation.
- Any server, any bundled ML model, anything that breaks "fully client-side, works offline".
- Do not modify the Claude path's behavior except: the fallback hint (§8), the key-gating change (§8), and the entry point that tries offline first.

## 12. Working style

- Branch per phase, small commits. Do not push to `main` without the owner's go-ahead if branch protection or review is desired — ask once at the start.
- All user-visible text at a plain, everyday reading level (the owner requires jargon-free explanations everywhere).
- When a decision here conflicts with what you find in the code, say so and propose the fix — don't silently pick one.
