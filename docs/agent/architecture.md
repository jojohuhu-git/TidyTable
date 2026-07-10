# TidyTable — Architecture & Module Map

Client-side only (React + Vite + SheetJS). No server. Created 2026-07-09 as a
starting map from the module layout — verify details against the code before
relying on a specific function signature.

## Data flow

1. **Upload** (`components/UploadPanel.jsx` → `logic/workbook.js`): SheetJS parses the file in the browser.
2. **Profile** (`logic/columnProfile.js`, `components/ColumnProfileTable.jsx`): column types/samples summarized.
3. **Prompt** (`components/PromptPanel.jsx` → `logic/claude.js`): builds the API request. Privacy modes decide what leaves the browser (default: column names + 10 sample rows; excluded columns never sent). Context construction is covered by `logic/claude.context.test.js`.
4. **Plan** (`logic/schema.js`): Claude returns a schema-enforced JSON plan containing a JS transform, Excel recipe steps, and an R script.
5. **Execute** (`logic/runTransform.js`): the JS transform runs in a sandboxed Web Worker on the full local dataset.
6. **Outputs**: results table (`components/ResultsPanel.jsx`), Excel recipe (`logic/recipes/`, `components/RecipePanel.jsx`), R script (`logic/rscripts/`, `components/RstudioGuide.jsx`). The three outputs must describe the same transformation.

## Other subsystems

| Module | Purpose |
|---|---|
| `logic/offline/` | Offline formula engine (no-API path; part of the clinical workbench build). |
| `logic/stats/`, `components/StatsPanel.jsx`, `RegressionWizard.jsx` | Statistics workbench. |
| `logic/charts/`, `components/ChartsPanel.jsx`, `ChartPreview.jsx` | Charts. |
| `logic/checkup/`, `components/CheckupPanel.jsx` | Data quality checkup. |
| `logic/sessionPersistence.js`, `components/ShelfPanel.jsx`, `ReplayPanel.jsx` | Saving/replaying sessions. |
| `logic/synthetic.js`, `logic/exampleWorkbook.js` | Built-in example/synthetic data. |
| `components/ApiKeyPanel.jsx` | User's Anthropic key; localStorage only, with storage disclosure. |
| `logic/a11y/` | Accessibility helpers. |

## History pointers

The 10-step clinical workbench was built from the master spec at
`.claude/prompts/build-clinical-workbench.md`; dated handoffs from that build
live in `.claude/prompts/handoff-*.md`.
