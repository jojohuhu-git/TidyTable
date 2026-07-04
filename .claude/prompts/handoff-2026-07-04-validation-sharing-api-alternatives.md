# Opus Handoff — TidyTable: accuracy validation, sharing, and reducing API dependence

**Date:** 2026-07-04
**Repo:** https://github.com/jojohuhu-git/TidyTable (local: `~/Downloads/TidyTable`)
**Live app:** https://jojohuhu-git.github.io/TidyTable/
**Owner:** Joanne (jojohuhu-git). Explain findings in plain, jargon-free language — what and why, not just how.

## Who this app is for (design against this, not against yourself)

The target users are **Excel and RStudio novices**. Concretely:

- They clean data manually today: they can open a file, use AutoFilter to narrow rows, and count things by selecting them or by eye. That is the ceiling of their current skills.
- They do NOT know pivot tables, VLOOKUP, or most formulas. A step that says "add a helper column with =COUNTIFS(...)" is already a stretch; it must be taught, not assumed.
- They do not understand technical terms or code. Words like "function", "string", "boolean", "parse", "token", "schema", "transform", "dataframe", "null" mean nothing to them. Every user-facing sentence — in the UI, in error messages, and in everything Claude generates — must survive that filter.
- They have never opened RStudio. The existing in-app setup guide assumes this, which is right; hold every other output to the same bar.

When judging any feature or output in this handoff, the test is: *could someone whose whole toolkit is "filter and manually count" follow this without asking for help?*

---

## What TidyTable is (read this first)

A client-side React/Vite SPA (no backend, no database) deployed to GitHub Pages. The user:

1. Uploads an Excel/CSV file — parsed in the browser with SheetJS (`src/logic/workbook.js`). Per-column privacy exclusion; two sharing modes: "headers + 10 sample rows" (default) or "full data".
2. Types a plain-English request (e.g. "pull everyone over 65 missing a vaccination date").
3. The app calls the Anthropic API **directly from the browser** with the **user's own API key** (`src/logic/claude.js`, `dangerouslyAllowBrowser: true`, default model `claude-opus-4-8`, schema-enforced JSON via `output_config.format` — schema in `src/logic/schema.js`).
4. Claude returns a 4-part plan that must be mutually consistent:
   - `summary` — plain-English explanation of the logic
   - `transform_code` — a JS function body, executed locally in a sandboxed Web Worker on the FULL dataset (`src/logic/runTransform.js`)
   - `excel_steps` — beginner formula steps to reproduce the result manually in Excel
   - `r_script` — a standalone RStudio script (file.choose(), auto-install packages) reproducing the same result
5. Result table is downloadable as xlsx/csv; Excel steps and R script are the user's two independent verification paths.

**Dev facts you need:**
- `npm run dev` → port 5175. `npm run build` works.
- Dev-only hook to exercise the pipeline **without an API key**: load a file in the UI, then in the console `await window.__tidytable.applyPlan(plan)` runs any hand-written plan's `transform_code` and renders results.
- Known-answer test file: `sample-data/patients.xlsx` — 250 synthetic patients, 2 sheets. Query "patients over 65 with missing vaccination date" must return **8 rows**. Every 6th patient (i % 6 == 0) has a null Vaccination Date; ages are `18 + (i*7) % 70`; the Copay column deliberately mixes numbers and strings like "$25".
- The live Claude API path has NOT yet been exercised end-to-end (built keyless). If you have a key available, that's the first thing to smoke-test.
- Direct push to `main` is allowed on this repo; push to main deploys to Pages automatically.

---

## Your five workstreams

Questions 1–3 are Joanne's original questions; 4–5 were added once the audience (above) was pinned down. If you have to sequence them, do 4a–4d and the Q1 harness first — they raise the floor for everything else.

### 1. How do we validate the accuracy of the data cleaning?

Today, correctness rests entirely on Claude writing a correct transform — nothing checks it. Investigate and build:

a. **An automated eval harness** (highest value). A Node script (e.g. `eval/run-evals.mjs`) that:
   - defines a library of synthetic workbooks with known answers (generate with SheetJS like `sample-data/patients.xlsx` was; cover the messy cases: dates stored as text, mixed types, "$1,204" numbers, duplicate headers, blank rows, multiple sheets requiring joins, typo'd categories, 50k+ rows);
   - defines prompts + expected outputs for each;
   - calls the real API with the same system prompt as the app (import from `src/logic/claude.js` or extract it to a shared module), executes `transform_code` in Node (`new Function`), and diffs against expected rows;
   - **also runs the generated `r_script` headlessly** (`Rscript` is installed, or document install) with the file-picker line swapped for a fixed path, and diffs its CSV output — this tests the *consistency* promise, which is the app's core trust claim;
   - for `excel_steps`, evaluate feasibility of checking formulas with the HyperFormula npm package (open-source Excel-formula engine); if that's too fragile, define a manual spot-check protocol instead and say so honestly.
   - Report: accuracy rate per case and per surface (JS vs R agreement matters more than either being "right").

b. **In-app safeguards** worth designing (propose, estimate effort, implement the cheap ones):
   - a visible "how to trust this" panel: row counts in vs out, which filters dropped how many rows (could ask Claude to make transforms emit per-step counts);
   - a second cheap "verifier" API call (Haiku) that re-derives the expected result count from the sample and flags disagreement;
   - deterministic re-run check (same plan, same data → same output).

c. **Honest limits.** Document what validation can and cannot promise, in plain English, for the README and possibly an in-app note. Note that the Excel/R cross-checks share Claude as a common source — they catch execution bugs but a *misunderstood request* will be wrong in all three; the user's own reading of `summary` is the defense there. Say this clearly somewhere the user will see it.

### 2. How do we share this with other people?

The blocker is the API key: every new user must create an Anthropic account, add credit, and paste a key. Evaluate these paths, with real cost/abuse/privacy analysis, and recommend one:

a. **Status quo + better onboarding** — a one-page illustrated "get your key in 5 minutes" guide, a "Try the sample file" button in the app, a short demo GIF in the README. Zero infra, zero cost to Joanne.
b. **Shared-key proxy** — a tiny Cloudflare Worker (or Vercel edge function) that holds ONE Anthropic key server-side; the app calls the proxy instead of Anthropic when no personal key is set. Must include: per-IP/day rate limits, an access passcode Joanne can hand out, spend cap thinking (Anthropic workspace spend limits), and an honest privacy note (data now transits the proxy). Estimate monthly cost at, say, 20 users × 10 queries.
c. **Hybrid** (likely winner): personal key if you have one, passcode-gated shared proxy for invited colleagues.
d. Also cover distribution basics regardless of the above: is the repo README enough of a landing page; should the app have an in-page "About/Privacy" section for strangers.

**⚠️ PHI warning to include in whatever you build:** Joanne's field is healthcare. The Anthropic API is not a HIPAA-covered service by default (no BAA), so real patient data should NOT be sent in "full data" mode, and shared-proxy mode makes this a harder line. The app's column-exclusion + sample-only mode is the mitigation — the sharing guide must state this explicitly and plainly.

### 3. Is the Claude API the only way to run this?

Map the alternatives honestly, prototype the cheapest-to-test ones, and give a verdict:

a. **No-AI fallback mode** — a guided query builder (pick column → pick condition → pick value; chain filters; group-by). Covers maybe 70% of simple asks with zero cost/key. It can also emit the same Excel steps + R script from templates (deterministic — arguably *more* trustworthy than AI for the cases it covers). Estimate effort; this may be the best "share with anyone" answer combined with Q2a.
b. **Local in-browser models** (WebLLM/WebGPU, e.g. Qwen/Llama small models) — test whether any model that fits in a browser can reliably write the transform JSON. Expectation: no, but verify with 3–5 eval cases from Q1's harness and report failure modes. Note download size (~1–4 GB) and device requirements.
c. **Ollama on the user's machine** — the app could call `http://localhost:11434` for free local inference (needs CORS config `OLLAMA_ORIGINS`). Same reliability testing as (b), plus honest assessment of "install Ollama" as an ask for a non-technical user vs "get an API key".
d. **Other hosted providers** — the plan-generation call is one function (`requestPlan` in `src/logic/claude.js`); assess making it provider-pluggable (OpenAI/Gemini keys). Probably not worth it now, but state the cost of adding later.
e. **Conclusion format:** a simple table — option, quality, cost to user, cost to Joanne, privacy, setup pain — and one recommendation for "colleague with zero technical background" and one for "power user".

### 4. Novice-first audit — close the gaps between the build and the real audience

The v0.1 build was written before the audience above was pinned down. Audit and fix, in roughly this priority order:

a. **Excel verification should offer a "filter and count" path, not just formulas.** The users' one existing skill is AutoFilter + counting — meet them there. Update the system prompt (`src/logic/claude.js`) so that whenever the request can be verified with filters alone, `excel_steps` uses that path first: "Click the funnel icon on the Age column → Number Filters → Greater Than → 65", then "select the visible cells in column A and read **Count: N** in the status bar at the bottom of the window" (teach the status-bar count trick explicitly — it's exactly the manual counting they already do, just faster). Keep formulas as a fallback for cases filters can't express (cross-sheet checks, computed values), and when a formula is unavoidable, the steps must teach the mechanics: what the formula bar is, that you press Enter after typing, what "drag the fill handle" means (the small square at the cell's bottom-right corner).

b. **Jargon audit of everything the user reads.** Two surfaces:
   - *The UI itself* — e.g. the cost line currently says "roughly 1,041 tokens"; a novice doesn't know what a token is (say "about 1 cent of API credit" and hide the token count behind a tooltip or drop it). Sweep all copy, buttons, and error messages (`friendlyApiError` included) with the ban-list above.
   - *What Claude generates* — add an explicit instruction to the system prompt: write `summary`, `excel_steps`, and `r_run_notes` for someone who has never written a formula; forbid the ban-list words; target a plain reading level. Then make this testable: add a jargon check to the Q1 eval harness (scan generated text for the ban-list; flag violations) so prompt regressions get caught.

c. **Handle ambiguity by asking, not assuming.** Novices write vague requests ("clean up this data"), and the current schema forces Claude to silently pick an interpretation. Add an optional `clarifying_question` field to the plan schema (`src/logic/schema.js`): if the request is genuinely ambiguous, Claude returns a single plain-English question instead of a full plan, the app shows it with a text box, and the answer is appended to a re-request. One round-trip max, then it must answer with stated assumptions. This is cheap and directly prevents the worst novice failure mode: confidently wrong output they can't detect.

d. **First-run experience.** A novice landing on the live URL has to figure out three unfamiliar things at once (key, upload, prompt). Add: a "Try it with example data" button that loads `sample-data/patients.xlsx` (ship it in `public/`) and pre-fills an example request so they see the whole loop work before touching their own file; and a short "what happens to my data" explainer in plain words. Reassess the API-key panel copy for a person who has never heard of an API.

e. **Structured trust panel instead of a prose summary.** Novices can't audit code, so "What the AI did" is their entire window into correctness. Consider restructuring `summary` into labeled parts the schema enforces: *What I looked for / What I included / What I left out and why / Assumptions I made / How many rows came in vs out*. Row-in/row-out counts are computable locally (transform input vs output length) — display them regardless.

f. **A real usability test.** Before investing further, have one actual novice (a colleague matching the profile) run the loop on the sample file while someone watches silently. Write down every place they stall. This will re-rank items a–e better than any analysis. Deliverable: `docs/novice-test-notes.md`.

g. **Excel-flavor coverage.** The audience may be on Mac Excel, old Windows Excel, or Google Sheets. Decide and document a support policy: steps are written for Excel (Windows + Mac, no 365-only functions unless flagged), and optionally have the plan include a Sheets variant when the user picks it. At minimum, stop assuming 365-only functions like FILTER without a fallback.

### 5. New feature — suggest charts the user can build in Excel

Joanne wants the app to also suggest **graphical images (charts) the user can create in Excel** to best illustrate their extracted data. Design and implement:

a. **Schema extension** (`src/logic/schema.js`): add `chart_suggestions` — an array (0–3 items) of:
   - `title` — what the chart is called, in plain words ("Bar chart: patients missing a vaccination date, by region")
   - `why` — one sentence on what story this chart tells and when to use it ("Best when you want to compare groups at a glance")
   - `chart_type` — from a small fixed enum (bar, column, pie, line, scatter) so the app can render an icon/preview
   - `data_prep_steps` — if the result table isn't chart-ready, the steps to get it there (usually "download the result, then…"; often none needed if the transform already grouped)
   - `excel_steps` — beginner steps to make the chart in Excel: exactly which cells to select, then "Insert tab → Charts section → pick [type]", how to add a title and axis labels, and one sentence on reading the finished chart. Same novice bar as everything else: assume they have never inserted a chart; mention Windows/Mac differences only where the clicks differ.
   Charts should generally be built **from the downloaded result table** (small, clean) rather than the raw original sheet — simpler selections, less room for error.

b. **System-prompt guidance for good chart choice:** counts by category → bar/column; parts of a whole with ≤6 slices → pie (else bar); anything over time → line; two numeric columns → scatter; plain row-lists with nothing to aggregate → suggest a summary table or no chart (an empty array is a valid, honest answer — don't force a chart onto un-chartable results).

c. **UI:** a fourth results tab, "Make a chart", rendering each suggestion as a card with the why-sentence up front and the steps expandable. Nice-to-have, decide based on effort: a tiny in-app preview of what the chart will roughly look like (a simple SVG bar/line drawn from the actual result rows) so the user knows what they're aiming for before they open Excel.

d. **Validation hook-in:** add 2–3 chart-bearing cases to the Q1 eval harness (e.g. "totals by region" should yield a bar-chart suggestion whose selected range actually matches the result table's shape), plus the jargon check from 4b applied to chart steps.

e. **Out of scope for now** (note in docs, don't build): generating image files directly, and R/ggplot chart code — Excel-only per Joanne, revisit later.

---

## Ground rules

- Don't break the deployed app: anything experimental goes behind flags or in `eval/` / `docs/`.
- Keep the app serverless unless Q2 concludes a proxy is worth it — and if so, the proxy is a separate tiny repo/worker, not a rewrite.
- Write findings to `docs/` in this repo (e.g. `docs/validation-report.md`, `docs/sharing-plan.md`, `docs/engine-alternatives.md`), each with a plain-English summary at the top for Joanne.
- If a decision needs Joanne (spending her money, standing up a proxy, changing the privacy story), stop and ask rather than assuming.
