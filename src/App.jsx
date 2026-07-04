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
            Upload a spreadsheet, ask for what you need in plain English, and get the
            cleaned data — plus an Excel recipe and an RStudio script to double-check it.
          </p>
        </div>
        <ApiKeyPanel apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} />
      </header>

      <main>
        <section className="card">
          <h2><span className="step-num">1</span> Upload your spreadsheet</h2>
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
            <h2><span className="step-num">2</span> Describe what you want</h2>
            <PromptPanel
              prompt={prompt}
              setPrompt={setPrompt}
              onRun={handleRun}
              busy={busy}
              status={status}
              canRun={Boolean(apiKey && prompt.trim())}
              needsKey={!apiKey}
              dataContext={dataContext}
              model={model}
              privacyMode={privacyMode}
            />
            {error && <div className="error-box" role="alert">{error}</div>}
          </section>
        )}

        {plan && resultRows && (
          <section className="card">
            <h2><span className="step-num">3</span> Your results — and two ways to verify them</h2>
            <ResultsPanel plan={plan} rows={resultRows} />
          </section>
        )}
      </main>

      <footer className="footnote">
        Your spreadsheet is processed inside your browser. Only what you choose in the
        privacy settings is sent to Anthropic's API using your own key. Nothing is stored
        on any TidyTable server (there isn't one).
      </footer>
    </div>
  );
}
