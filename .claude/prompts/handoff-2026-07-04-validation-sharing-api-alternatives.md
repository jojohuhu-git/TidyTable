# Opus Handoff — TidyTable: accuracy validation, sharing, and reducing API dependence

**Date:** 2026-07-04
**Repo:** https://github.com/jojohuhu-git/TidyTable (local: `~/Downloads/TidyTable`)
**Live app:** https://jojohuhu-git.github.io/TidyTable/
**Owner:** Joanne (jojohuhu-git). Explain findings in plain, jargon-free language — what and why, not just how.

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

## Your three questions to answer

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

---

## Ground rules

- Don't break the deployed app: anything experimental goes behind flags or in `eval/` / `docs/`.
- Keep the app serverless unless Q2 concludes a proxy is worth it — and if so, the proxy is a separate tiny repo/worker, not a rewrite.
- Write findings to `docs/` in this repo (e.g. `docs/validation-report.md`, `docs/sharing-plan.md`, `docs/engine-alternatives.md`), each with a plain-English summary at the top for Joanne.
- If a decision needs Joanne (spending her money, standing up a proxy, changing the privacy story), stop and ask rather than assuming.
