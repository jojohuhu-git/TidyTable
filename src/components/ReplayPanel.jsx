import { useRef, useState } from "react";
import { parseWorkbookFile, downloadText, downloadRowsAsXlsx } from "../logic/workbook.js";
import { listRecipes, parseRecipe } from "../logic/recipes/recipe.js";
import { replayRecipe, formatReplayReport } from "../logic/recipes/replay.js";
import { serializeKeyStore, persistKeyStore } from "../logic/recipes/keyStore.js";
import { formatCleaningLog, makeLogEvent } from "../logic/checkup/cleaningLog.js";
import ReportCardsView from "./ReportCardsView.jsx";

// Step 6 (build prompt §7; W3 rename — "Run a saved routine…"): replay a saved
// routine on next month's file. Runs the recorded rules, then reports what
// happened and — loudly — anything the rules did not cover. Nothing is
// guessed silently and no data is dropped without saying so. (The underlying
// object is still a "recipe" in code, per the W3 UI-copy-only rename.)
export default function ReplayPanel({ keyStore, onKeyStore }) {
  const [saved, setSaved] = useState(() => listRecipes());
  const [recipe, setRecipe] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const recipeInput = useRef(null);
  const dataInput = useRef(null);

  async function onDataFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setResult(null);
    try {
      const wb = await parseWorkbookFile(file);
      setSheet(wb.sheets[0]);
      setFileName(wb.fileName);
    } catch (err) {
      setError(err.message || "That file could not be read.");
    }
  }

  async function onRecipeFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setRecipe(parseRecipe(await file.text()));
    } catch (err) {
      setError(err.message || "That routine file could not be read.");
    }
  }

  function pickSaved(name) {
    setRecipe(saved.find((r) => r.name === name) || null);
    setResult(null);
  }

  function run() {
    setError("");
    if (!recipe || !sheet) return;
    const res = replayRecipe(recipe, sheet, keyStore);
    setResult(res);
    if (res.keyStore) {
      persistKeyStore(res.keyStore);
      if (onKeyStore) onKeyStore(res.keyStore);
    }
  }

  function downloadReport() {
    downloadText(formatReplayReport(recipe, result, fileName), "TidyTable_replay_report.txt");
  }
  function downloadData() {
    downloadRowsAsXlsx(result.rows, "TidyTable_replayed.xlsx");
  }
  function downloadLog() {
    const ev = makeLogEvent({ fileName, sheet: sheet.name, entries: result.logEntries });
    downloadText(formatCleaningLog([ev]), "TidyTable_replay_cleaning_log.txt");
  }
  function downloadKeyFile() {
    downloadText(serializeKeyStore(result.keyStore), "TidyTable_code_list.json");
  }

  return (
    <div className="replay-panel">
      <div className="replay-inputs">
        <div>
          <p className="dim">1. Choose the routine to run.</p>
          {saved.length > 0 && (
            <select
              value={recipe && saved.some((r) => r.name === recipe.name) ? recipe.name : ""}
              onChange={(e) => pickSaved(e.target.value)}
            >
              <option value="">a saved routine…</option>
              {saved.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => recipeInput.current?.click()}>
            or open a routine file
          </button>
          <input ref={recipeInput} type="file" accept=".json" hidden onChange={onRecipeFile} />
          {recipe && <p className="dim">Ready: “{recipe.name}” ({recipe.steps.length} steps).</p>}
        </div>

        <div>
          <p className="dim">2. Choose next month's file. It stays on this computer.</p>
          <button type="button" className="btn" onClick={() => dataInput.current?.click()}>
            Choose spreadsheet
          </button>
          <input ref={dataInput} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onDataFile} />
          {sheet && <p className="dim">Ready: {fileName}, sheet “{sheet.name}” ({sheet.rowCount} rows).</p>}
        </div>

        <button type="button" className="btn btn-primary" onClick={run} disabled={!recipe || !sheet}>
          Run the routine on this file
        </button>
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}

      {result && (
        <div className="replay-result">
          <h3>What happened</h3>
          <ul className="replay-steps">
            {result.steps.map((s, i) => (
              <li key={i} className={s.skipped ? "replay-step-skipped" : ""}>
                {s.label}
                {s.skipped ? " (skipped)" : ""} —{" "}
                {s.rowsBefore === s.rowsAfter ? `${s.rowsAfter} rows` : `${s.rowsBefore} to ${s.rowsAfter} rows`}
                {s.note ? `, ${s.note}` : ""}
              </li>
            ))}
          </ul>

          {result.surprises.length === 0 ? (
            <p className="replay-ok">No surprises: every recorded rule covered this file.</p>
          ) : (
            <div className="replay-surprises" role="alert">
              <h3>Surprises that need your attention</h3>
              <ul>
                {result.surprises.map((s, i) => <li key={i}>{s.message}</li>)}
              </ul>
            </div>
          )}

          {result.reportCards && <ReportCardsView reportCards={result.reportCards} />}

          <div className="run-row">
            <button type="button" className="btn" onClick={downloadData}>Download the cleaned data</button>
            <button type="button" className="btn btn-ghost" onClick={downloadReport}>Download the replay report</button>
            <button type="button" className="btn btn-ghost" onClick={downloadLog}>Download the cleaning log</button>
            {result.keyStore && Object.keys(result.keyStore.codes).length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={downloadKeyFile}>Download the code list</button>
            )}
          </div>
          {result.keyStore && Object.keys(result.keyStore.codes).length > 0 && (
            <p className="dim">
              The code list links each code back to a real name. Keep it private and separate from
              any report you share — the reports above contain codes only.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
