import { useMemo, useState } from "react";
import ApiKeyPanel from "./components/ApiKeyPanel.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import PromptPanel from "./components/PromptPanel.jsx";
import ResultsPanel from "./components/ResultsPanel.jsx";
import {
  buildDataContext,
  requestPlan,
  friendlyApiError,
  DEFAULT_MODEL,
} from "./logic/claude.js";
import { runTransform } from "./logic/runTransform.js";

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

  const dataContext = useMemo(() => {
    if (!workbook) return "";
    return buildDataContext(workbook, { excluded, privacyMode });
  }, [workbook, excluded, privacyMode]);

  async function handleRun() {
    setError("");
    setPlan(null);
    setResultRows(null);
    // Until the offline engine lands, running a request needs the AI, which needs
    // a key. Say so plainly rather than blocking the whole step.
    if (!apiKey) {
      setError(
        "This request needs the AI for now. Add your key using the button at the top right, then run it again.",
      );
      return;
    }
    setBusy(true);
    try {
      setStatus("Sending your request to Claude…");
      const newPlan = await requestPlan({
        apiKey,
        model,
        dataContext,
        userRequest: prompt,
        onStatus: setStatus,
      });
      setPlan(newPlan);

      setStatus("Running the extraction on your full data (inside your browser)…");
      const sheetsByName = Object.fromEntries(
        workbook.sheets.map((s) => [s.name, s.rows]),
      );
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

  function handleWorkbook(wb) {
    setWorkbook(wb);
    setExcluded(new Set());
    setPlan(null);
    setResultRows(null);
    setError("");
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
            <h2><span className="step-label">Step 2</span> — Describe what you want</h2>
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
            {error && <div className="error-box" role="alert">{error}</div>}
          </section>
        )}

        {workbook && (
          <section className="card">
            <h2><span className="step-label">Step 3</span> — Your results</h2>
            <p className="section-intro">
              Once you run a request, your cleaned data appears here, along with two ways to
              check it yourself: an Excel recipe and an RStudio script.
            </p>
            {plan && resultRows ? (
              <ResultsPanel plan={plan} rows={resultRows} />
            ) : (
              <p className="empty-state">
                Nothing to show yet. Describe what you want in step 2 and run it — the result,
                the Excel recipe, and the RStudio script will appear here.
              </p>
            )}
          </section>
        )}
      </main>

      <footer className="footnote">
        Your spreadsheet is processed inside your browser. Only what you choose in the
        privacy settings is ever sent to the AI, using your own key. Nothing is stored on
        any TidyTable server (there isn't one).
      </footer>
    </div>
  );
}
