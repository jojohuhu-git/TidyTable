# TidyTable

Upload an Excel spreadsheet, describe what you want in plain English, and get:

1. **The cleaned/extracted data** — computed entirely in your browser, downloadable as .xlsx or .csv.
2. **A step-by-step Excel recipe** (exact formulas, exact cells) to reproduce the result by hand and validate it.
3. **A ready-to-run RStudio script** plus beginner instructions (Mac & Windows) that reproduces the same result a third way.

Live app: https://jojohuhu-git.github.io/TidyTable/

## How it works

- Everything is client-side (React + Vite + SheetJS). There is no TidyTable server.
- Plain-English understanding uses Anthropic's Claude API with **your own API key** (entered in the app, stored only in your browser's localStorage).
- Privacy modes: send only column names + 10 sample rows (default), or the whole sheet. Individual columns can be excluded so their values never leave your computer.
- Claude returns a JSON plan (schema-enforced): a JavaScript transform (run locally in a sandboxed Web Worker on the full dataset), the Excel validation steps, and the R script.

## Development

```bash
npm install
npm run dev     # http://localhost:5175
npm run build   # production build to dist/
```

Deploys to GitHub Pages automatically on push to `main` via `.github/workflows/deploy.yml`.
