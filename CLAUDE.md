# TidyTable Agent Guide

## What This App Is

Client-side React + Vite + SheetJS SPA: upload an Excel/CSV file, describe a cleaning task in plain English, get the transformed data plus an Excel recipe and an R script that reproduce it. No backend — plain-English understanding calls the Anthropic API with the **user's own key** (localStorage only). Live at https://jojohuhu-git.github.io/TidyTable/

## Start Here

```bash
npm install
npm run dev        # dev server on port 5175
npm test           # Vitest run
npm run build      # production build to dist/
```

Dev server config: `.claude/launch.json`. All public asset paths MUST use `import.meta.env.BASE_URL` (Vite sets `base: '/TidyTable/'`).

## Deploy — Push Publishes

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`. **The owner reviews before any push** — commit locally; do not push without explicit go-ahead.

## Source of Truth Files

| What | Where |
|---|---|
| Plain-English folder guide (owner is a non-coder) | [MAP.md](MAP.md) |
| Architecture, module map, data flow | [docs/agent/architecture.md](docs/agent/architecture.md) |
| Build specs and past handoffs | `.claude/prompts/` |
| Session history | [docs/archive/agent-session-log.md](docs/archive/agent-session-log.md) |

## Non-Negotiable Rules

### Root Directory Hygiene
Only `CLAUDE.md`, `MAP.md`, and `README.md` live at the repo root. Never create new root-level `.md` files. Session notes/handoffs go to `docs/archive/`; reusable prompts/specs go to `.claude/prompts/`; durable technical knowledge goes to `docs/agent/`.

### Privacy Is a Product Guarantee
Default mode sends only column names + 10 sample rows to the API; columns the user excludes must NEVER leave the browser in any payload. Any change to `src/logic/claude.js` context building must preserve this and keep `claude.context.test.js` passing.

### Transforms Run Sandboxed
Claude returns a schema-enforced JSON plan (`src/logic/schema.js`); the JavaScript transform executes only inside the Web Worker sandbox (`src/logic/runTransform.js`) on the local data. Never eval plan code on the main thread.

### Three Outputs Stay in Sync
A plan produces the browser result, the Excel recipe (`src/logic/recipes/`), and the R script (`src/logic/rscripts/`). A logic change to one output surface must be checked against the other two — they must describe the same transformation.

## Testing Expectations

- Tests are colocated: `*.test.js` next to logic in `src/logic/`, `*.dom.test.jsx` next to components (plus `test/` for app-level DOM tests).
- Logic change → logic test; visible UI change → DOM test. Regression tests must fail when the fix is reverted.

## Documentation Maintenance

| Content type | Destination |
|---|---|
| Current commands, required workflow, short non-negotiable rules | Root `CLAUDE.md` (this file) |
| Architecture, module map, data flow | `docs/agent/architecture.md` |
| Dated "session changes" / handoffs | `docs/archive/agent-session-log.md` |
| Reusable build specs / one-off task prompts | `.claude/prompts/` |
| Plain-English folder explanations for the owner | `MAP.md` |

Do not add dated session logs, implementation narratives, or stale local paths to this file.
