# Map of This Project (plain English)

TidyTable — upload a spreadsheet, describe what you want in plain English, get the
cleaned data plus an Excel recipe and an R script that reproduce it.
Live at https://jojohuhu-git.github.io/TidyTable/

This file explains what every folder and file is for, in plain language.
If you only remember one rule: **new notes never go in the top level of this
folder — they go where the table at the bottom says.**

> Publishing note: pushing changes to `main` on GitHub automatically updates the
> live app. Work is committed locally first and only pushed after you approve.

## The app itself (the working parts)

| Folder / file | What it is |
|---|---|
| `src/` | The app's working parts. This is where the actual program lives. |
| `src/components/` | The panels and screens you see: upload, prompt box, results, charts, stats, recipes. |
| `src/logic/` | The "brain": reading spreadsheets, talking to Claude, running transforms safely, building the Excel recipe and R script, offline formula engine, stats. |
| `index.html` | The single web page the app loads into. |
| `sample-data/` | Example spreadsheets for trying the app. |
| `test/` | App-level tests that check whole screens behave correctly. |

## Instructions and manuals

| Folder / file | What it is |
|---|---|
| `CLAUDE.md` | The instruction sheet the AI assistant reads at the start of every session. Short on purpose. |
| `MAP.md` | This file — the building directory. |
| `README.md` | The public description of the app for anyone visiting the code online. |
| `docs/agent/` | The technical manuals (architecture, module map). |
| `docs/prompting-guide.md` | **For you** — how to phrase requests in each step for accurate results, plus current limitations and the privacy rules. Kept current as features ship. |
| `docs/archive/` | Old session notes and handoffs. Nothing here is current; kept for history. Safe to ignore. |
| `.claude/prompts/` | Saved build specifications and past work orders for the AI assistant. |

## Machine-managed — never edit by hand

| Folder / file | What it is |
|---|---|
| `dist/` | The packaged copy of the app that gets published. Rebuilt by machine; edits here are overwritten. |
| `node_modules/` | Third-party building blocks, downloaded automatically by `npm install`. |
| `package.json` / `package-lock.json` | The app's parts list and the exact versions in use. |
| `vite.config.js`, `vitest.config.js` | Build and test machinery settings. |

## Where do new things go?

| If a session produces… | It goes in… |
|---|---|
| A change to how the app looks or behaves | `src/` (plus a test) |
| A new rule for how agents must work | `CLAUDE.md` (only if it applies to every future session) |
| Technical detail worth keeping (architecture, data flow) | `docs/agent/architecture.md` |
| "What we did today" notes and handoffs | `docs/archive/` |
| A reusable build spec or task prompt | `.claude/prompts/` |
| **Nothing** ever goes loose in the top-level folder. | |
