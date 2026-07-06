import { useMemo, useState } from "react";
import ApiKeyPanel from "./components/ApiKeyPanel.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import CheckupPanel from "./components/CheckupPanel.jsx";
import PromptPanel from "./components/PromptPanel.jsx";
import ResultsPanel from "./components/ResultsPanel.jsx";
import RecipePanel from "./components/RecipePanel.jsx";
import ReplayPanel from "./components/ReplayPanel.jsx";
import {
  buildDataContext,
  requestPlan,
  friendlyApiError,
  DEFAULT_MODEL,
} from "./logic/claude.js";
import { runTransform } from "./logic/runTransform.js";
import { deriveSheet, downloadText } from "./logic/workbook.js";
import { buildFixPlan } from "./logic/checkup/buildFixPlan.js";
import { makeLogEvent, formatCleaningLog } from "./logic/checkup/cleaningLog.js";
import { newRecipe, addStep, checkupStep } from "./logic/recipes/recipe.js";
import { loadKeyStore } from "./logic/recipes/keyStore.js";
import { runOffline } from "./logic/offline/runOffline.js";
import ClarifyBox from "./components/ClarifyBox.jsx";

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("tidytable_api_key") || "");
  const [model, setModel] = useState(() => localStorage.getItem("tidytable_model") || DEFAULT_MODEL);
  const [workbook, setWorkbook] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set()); // "sheet::column"
  const [privacyMode, setPrivacyMode] = useState("sample"); // "sample" | "full"
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null);
  const [resultRows, setResultRows] = useState(null);
  const [sessionLog, setSessionLog] = useState([]);
  const [checkupVersion, setCheckupVersion] = useState(0);
  const [recipe, setRecipe] = useState(() => newRecipe());
  const [keyStore, setKeyStore] = useState(() => loadKeyStore());
  const [notice, setNotice] = useState(""); // plain, non-error message (e.g. "add a definition")
  const [pendingGrain, setPendingGrain] = useState(null); // { grain, request } awaiting a combine-rows answer

  const dataContext = useMemo(() => {
    if (!workbook) return "";
    return buildDataContext(workbook, { excluded, privacyMode });
  }, [workbook, excluded, privacyMode]);

  // Every request tries the offline engine first (build prompt §3.3). A confident
  // answer needs no key; an undefined clinical term blocks plainly; a per-patient
  // question over repeating rows asks before answering; anything out of range
  // declines and, if a key exists, is offered to Claude.
  async function runOfflineFlow(request, options) {
    const res = runOffline(request, workbook, options);
    if (res.kind === "answer") {
      setPlan(res.plan);
      setResultRows(res.resultRows);
      return;
    }
    if (res.kind === "block") {
      setNotice(res.message);
      return;
    }
    if (res.kind === "clarify-grain") {
      setPendingGrain({ grain: res.grain, request });
      return;
    }
    // res.kind === "decline"
    if (!apiKey) {
      setNotice(res.message);
      return;
    }
    await runViaClaude(request, res.claudeHint);
  }

  async function runViaClaude(request, hint) {
    setBusy(true);
    try {
      setStatus("Sending your request to Claude…");
      const userRequest = hint ? `${request}\n\n(${hint})` : request;
      const newPlan = await requestPlan({ apiKey, model, dataContext, userRequest, onStatus: setStatus });
      setPlan(newPlan);
      setStatus("Running the extraction on your full data (inside your browser)…");
      const sheetsByName = Object.fromEntries(workbook.sheets.map((s) => [s.name, s.rows]));
      const rows = await runTransform(newPlan.transform_code, sheetsByName);
      setResultRows(rows);
      setStatus("");
    } catch (err) {
      setError(friendlyApiError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    setError("");
    setNotice("");
    setPlan(null);
    setResultRows(null);
    setPendingGrain(null);
    await runOfflineFlow(prompt, {});
  }

  // The user answered the grain question: "combine" runs per-entity, "rows" keeps
  // one row at a time. Either way we re-run the same request with that decision.
  function answerGrain(mode) {
    const request = pendingGrain?.request;
    setPendingGrain(null);
    if (request) runOfflineFlow(request, { grainMode: mode });
  }

  function handleWorkbook(wb) {
    setWorkbook(wb);
    setExcluded(new Set());
    setPlan(null);
    setResultRows(null);
    setError("");
    setNotice("");
    setPendingGrain(null);
    setSessionLog([]);
    setRecipe(newRecipe());
    setCheckupVersion((v) => v + 1);
  }

  // Apply the checkup fixes the user picked: build an offline plan, run it on the
  // full data, show the result, replace the sheet with the cleaned rows (so later
  // steps use them), and append to the cleaning log. Checkup runs on the first
  // sheet for now.
  async function handleApplyFixes(fixes) {
    if (!fixes.length) return;
    const sheet = workbook.sheets[0];
    setError("");
    setBusy(true);
    setStatus("Applying your fixes on this computer…");
    try {
      const { plan: fixPlan, log } = buildFixPlan(sheet, fixes);
      const rows = await runTransform(fixPlan.transform_code, { [sheet.name]: sheet.rows });
      setPlan(fixPlan);
      setResultRows(rows);
      const cleaned = deriveSheet(sheet.name, rows);
      setWorkbook({ ...workbook, sheets: workbook.sheets.map((s, i) => (i === 0 ? cleaned : s)) });
      setSessionLog((l) => [...l, makeLogEvent({ fileName: workbook.fileName, sheet: sheet.name, entries: log })]);
      // Record each applied fix into the monthly recipe so it can be replayed
      // on next month's file (build prompt §7).
      setRecipe((r) => fixes.reduce((acc, fix) => addStep(acc, checkupStep(fix)), r));
      setCheckupVersion((v) => v + 1);
      setStatus("");
    } catch (err) {
      setError(friendlyApiError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  // Dev-only hook so the pipeline can be exercised without an API key.
  if (import.meta.env.DEV) {
    window.__tidytable = {
      getWorkbook: () => workbook,
      applyPlan: async (fakePlan) => {
        const sheetsByName = Object.fromEntries(workbook.sheets.map((s) => [s.name, s.rows]));
        const rows = await runTransform(fakePlan.transform_code, sheetsByName);
        setPlan(fakePlan);
        setResultRows(rows);
        return rows.length;
      },
    };
  }

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>TidyTable</h1>
          <p className="tagline">
            Upload a spreadsheet, ask for what you need in plain words, and get the
            cleaned data — plus an Excel recipe and an RStudio script to double-check it.
          </p>
          <p className="privacy-badge">Your data has not left this computer.</p>
        </div>
        <ApiKeyPanel apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} />
      </header>

      <main>
        <section className="card">
          <h2><span className="step-label">Step 1</span> — Upload your spreadsheet</h2>
          <p className="section-intro">
            Drop an Excel file here, or click to choose one. Nothing is uploaded anywhere —
            the file stays on this computer, and you decide later what, if anything, is sent
            to the AI.
          </p>
          <UploadPanel
            workbook={workbook}
            onWorkbook={handleWorkbook}
            excluded={excluded}
            setExcluded={setExcluded}
            privacyMode={privacyMode}
            setPrivacyMode={setPrivacyMode}
          />
        </section>

        {workbook && (
          <section className="card">
            <h2><span className="step-label">Step 2</span> — Check your data for problems</h2>
            <p className="section-intro">
              Before you do anything else, here is what an automatic check found in your data —
              duplicates, missing values, numbers stored as text, and more. Tick the ones you
              want fixed and apply them. Nothing changes until you choose it.
              {workbook.sheets.length > 1 && (
                <> Only the first sheet, "{workbook.sheets[0].name}", is checked for now.</>
              )}
            </p>
            <CheckupPanel
              key={`checkup-${checkupVersion}`}
              sheet={workbook.sheets[0]}
              busy={busy}
              onApply={handleApplyFixes}
            />
          </section>
        )}

        {sessionLog.length > 0 && (
          <section className="card">
            <h2>Cleaning log</h2>
            <p className="section-intro">
              A plain-English record of every change made in this session, with row counts. Keep
              it as your trail for reviewers or committees.
            </p>
            <div className="log-box">{formatCleaningLog(sessionLog)}</div>
            <div className="row-end">
              <button
                className="btn btn-ghost"
                onClick={() => downloadText(formatCleaningLog(sessionLog), "TidyTable_cleaning_log.txt")}
              >
                Download cleaning log
              </button>
            </div>
          </section>
        )}

        {workbook && (
          <section className="card">
            <h2><span className="step-label">Step 3</span> — Describe what you want</h2>
            <p className="section-intro">
              Ask for what you need the way you'd ask a colleague — no formulas, no jargon.
              You'll get a clear summary of what was done and a result you can download.
            </p>
            <PromptPanel
              prompt={prompt}
              setPrompt={setPrompt}
              onRun={handleRun}
              busy={busy}
              status={status}
              canRun={Boolean(prompt.trim())}
              needsKey={!apiKey}
              dataContext={dataContext}
              model={model}
              privacyMode={privacyMode}
            />
            {pendingGrain && (
              <ClarifyBox
                question={pendingGrain.grain.question}
                options={[
                  { value: "group-then-test", label: `Combine each ${pendingGrain.grain.entity}'s rows first`, detail: `count ${pendingGrain.grain.entity}s` },
                  { value: "row", label: "Count rows as they are", detail: "one row at a time" },
                ]}
                onAnswer={answerGrain}
                onCancel={() => setPendingGrain(null)}
              />
            )}
            {notice && <div className="notice-box" role="status">{notice}</div>}
            {error && <div className="error-box" role="alert">{error}</div>}
          </section>
        )}

        {workbook && (
          <section className="card">
            <h2><span className="step-label">Step 4</span> — Your results</h2>
            <p className="section-intro">
              When you apply checkup fixes or run a request, your cleaned data appears here,
              along with two ways to check it yourself: an Excel recipe and an RStudio script.
            </p>
            {plan && resultRows ? (
              <ResultsPanel plan={plan} rows={resultRows} />
            ) : (
              <p className="empty-state">
                Nothing to show yet. Apply a fix in step 2, or describe what you want in step 3
                and run it — the result and the ways to check it will appear here.
              </p>
            )}
          </section>
        )}

        {workbook && (
          <section className="card">
            <h2><span className="step-label">Step 5</span> — Save a monthly recipe</h2>
            <p className="section-intro">
              If this is a file you clean every month, save the steps as a recipe and replay them
              next month in step 6. The checkup fixes you applied are recorded below. You can also
              add a step that swaps names for stable codes and a final step that makes report cards.
            </p>
            <RecipePanel recipe={recipe} sheet={workbook.sheets[0]} onChange={setRecipe} />
          </section>
        )}

        <section className="card">
          <h2><span className="step-label">Step 6</span> — Replay on next month's file</h2>
          <p className="section-intro">
            Pick a saved recipe and next month's file. The recorded steps run again, and you get a
            plain report of what happened — including anything new the rules did not cover, said
            plainly rather than guessed. Report cards, if the recipe makes them, show codes only.
          </p>
          <ReplayPanel keyStore={keyStore} onKeyStore={setKeyStore} />
        </section>
      </main>

      <footer className="footnote">
        Your spreadsheet is processed inside your browser. Only what you choose in the
        privacy settings is ever sent to the AI, using your own key. Nothing is stored on
        any TidyTable server (there isn't one).
      </footer>
    </div>
  );
}
