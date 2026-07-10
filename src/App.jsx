import { useEffect, useMemo, useRef, useState } from "react";
import ApiKeyPanel from "./components/ApiKeyPanel.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import CheckupPanel from "./components/CheckupPanel.jsx";
import PromptPanel from "./components/PromptPanel.jsx";
import ResultsListPanel from "./components/ResultsListPanel.jsx";
import RecipePanel from "./components/RecipePanel.jsx";
import ReplayPanel from "./components/ReplayPanel.jsx";
import {
  buildDataContext,
  requestPlan,
  friendlyApiError,
  DEFAULT_MODEL,
} from "./logic/claude.js";
import { runTransform } from "./logic/runTransform.js";
import { deriveSheet, downloadText, downloadWorkbookAsXlsx } from "./logic/workbook.js";
import { foldKey } from "./logic/checkup/normalizers.js";
import { buildFixPlan } from "./logic/checkup/buildFixPlan.js";
import { makeLogEvent, formatCleaningLog } from "./logic/checkup/cleaningLog.js";
import { newRecipe, addStep, checkupStep, questionStep, defaultRoutineName } from "./logic/recipes/recipe.js";
import { loadKeyStore } from "./logic/recipes/keyStore.js";
import { runOffline } from "./logic/offline/runOffline.js";
import { summarizeAnswer } from "./logic/offline/fillPlan.js";
import { buildExampleWorkbook } from "./logic/exampleWorkbook.js";
import { saveSession, loadSession } from "./logic/sessionPersistence.js";
import ClarifyBox from "./components/ClarifyBox.jsx";
import StatsPanel from "./components/StatsPanel.jsx";
import RegressionWizard from "./components/RegressionWizard.jsx";
import ChartsPanel from "./components/ChartsPanel.jsx";
import ShelfPanel from "./components/ShelfPanel.jsx";
import ColumnProfileTable from "./components/ColumnProfileTable.jsx";
import DefinitionsEditor from "./components/DefinitionsEditor.jsx";
import DefinitionsPanel from "./components/DefinitionsPanel.jsx";
import { privacyBadgeText } from "./logic/privacyBadge.js";
import { emptyDefinitionsStore, addDefinitionEntry } from "./logic/offline/definitionsStore.js";

// W3: how many result cards "Your results so far" keeps per session, oldest
// dropped first — the same bounded-history spirit the old run-history chips
// used, now applied to the full accumulating list.
const MAX_RESULTS = 20;

// W1: "DC antibiotics.xlsx" -> "DC antibiotics (cleaned).xlsx". Drops any
// original extension (csv/xls/xlsx/tsv) and always writes a real .xlsx, since
// the downloaded copy is an Excel workbook regardless of what was uploaded.
function fixedFileName(originalName) {
  const name = originalName || "TidyTable_workbook";
  const base = name.replace(/\.(xlsx|xls|csv|tsv)$/i, "").trim() || "TidyTable_workbook";
  return `${base} (cleaned).xlsx`;
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("tidytable_api_key") || "");
  const [model, setModel] = useState(() => localStorage.getItem("tidytable_model") || DEFAULT_MODEL);
  const [workbook, setWorkbook] = useState(null);
  const [originalWorkbook, setOriginalWorkbook] = useState(null); // B4: "start over" target
  const [excluded, setExcluded] = useState(() => new Set()); // "sheet::column"
  const [privacyMode, setPrivacyMode] = useState("sample"); // "sample" | "full"
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null);
  const [resultRows, setResultRows] = useState(null);
  const [undoSnapshot, setUndoSnapshot] = useState(null); // B4: state just before the last apply
  // B5: the workbook itself is not restored (it may be large or sensitive), but
  // the small, JSON-safe log/recipe/results trail survives a refresh.
  const savedSession = useMemo(() => loadSession(), []);
  const [sessionLog, setSessionLog] = useState(() => savedSession?.sessionLog || []);
  const [checkupVersion, setCheckupVersion] = useState(0);
  const [recipe, setRecipe] = useState(() => savedSession?.recipe || newRecipe());
  // W3 (Step 4 — "Your results so far"): every checkup-fix apply and every
  // answered question accumulates here, newest first, instead of the old
  // single "most recent result" view. Each entry: { id, kind, label, answer,
  // timestamp, plan, resultRows, savedToRoutine }. `plan`/`resultRows` are not
  // persisted (they can be as large as the workbook) — after a refresh a card
  // still shows its label/answer, but expanding it explains detail isn't
  // available rather than showing stale or missing data.
  const [results, setResults] = useState(() => savedSession?.results || []);
  const [expandedResultId, setExpandedResultId] = useState(null);
  const [keyStore, setKeyStore] = useState(() => loadKeyStore());
  const [notice, setNotice] = useState(""); // plain, non-error message (e.g. "add a definition")
  const [pendingGrain, setPendingGrain] = useState(null); // { grain, request } awaiting a combine-rows answer
  // B7: in-app definitions, merged on top of a real Definitions sheet if the
  // workbook has one; resets with the workbook, like excluded columns.
  const [definitionsStore, setDefinitionsStore] = useState(() => emptyDefinitionsStore());
  const [pendingDefinitions, setPendingDefinitions] = useState(null); // { missingTerms, message, request, nearest }
  // W2d: "Did you mean…?" middle-path confirmation when the offline matcher
  // had to stretch (an abbreviation, a partial value match, a fuzzy column
  // scope, or a tie between candidates) to reach a value.
  const [pendingConfirm, setPendingConfirm] = useState(null); // { phrase, candidates, via, request }
  // W2d: phrase (folded) -> the confirmed { column, value } candidate, so the
  // same stretch never asks twice in this session. Session-only, like the
  // rest of the in-memory state — cleared on a fresh upload.
  const [aliasMap, setAliasMap] = useState(() => new Map());
  // B8: the privacy badge must stay true — track every actual send to Claude
  // this session (mode at send time), instead of a permanent claim that never
  // updates once a full-mode request has gone out.
  const [aiSends, setAiSends] = useState([]); // [{ mode: "sample" | "full" }]
  // B11: a transform failure gets exactly one offered retry, so a Claude
  // hiccup isn't a dead end — set on the first failure, cleared on success,
  // a fresh request, or a second failure (only one retry, ever).
  const [retryInfo, setRetryInfo] = useState(null); // { request, hint, failedCode, error }
  const resultsRef = useRef(null);

  const dataContext = useMemo(() => {
    if (!workbook) return "";
    return buildDataContext(workbook, { excluded, privacyMode });
  }, [workbook, excluded, privacyMode]);

  // B5/W3: persist the log/recipe/results trail (small JSON — results are
  // stripped of plan/resultRows first, see recordResult) so an accidental
  // refresh doesn't erase the record of what happened this session.
  useEffect(() => {
    const persistableResults = results.map(({ plan: _plan, resultRows: _resultRows, ...rest }) => rest);
    saveSession({ sessionLog, recipe, results: persistableResults });
  }, [sessionLog, recipe, results]);

  // B5: warn before an accidental refresh/close loses the loaded workbook.
  useEffect(() => {
    if (!workbook) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [workbook]);

  // B3/W3: a fresh result should be easy to find on a long page. Every result
  // — a checkup-fix apply or an answered question, offline or AI — becomes a
  // new card at the top of "Your results so far" (Step 4), which doubles as
  // this session's undo-able history (the old chip-based run history is
  // folded into this one list). `kind` is "checkup" or "question"; a question
  // answered by the offline engine is also recorded into the routine
  // (`savedToRoutine: true`) by the caller.
  function recordResult({ label, answer, plan: newPlan, resultRows: newResultRows, kind, savedToRoutine }) {
    const id = `${Date.now()}-${Math.random()}`;
    setPlan(newPlan);
    setResultRows(newResultRows);
    setResults((r) => [
      { id, kind, label, answer, timestamp: Date.now(), plan: newPlan, resultRows: newResultRows, savedToRoutine: Boolean(savedToRoutine) },
      ...r,
    ].slice(0, MAX_RESULTS));
    setExpandedResultId(id);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  // W3: per-card "Remove" in "Your results so far" — takes the card out of
  // the visible list only. It does not undo a checkup fix already applied to
  // the workbook and does not remove a recorded routine step (removing a
  // routine step is done in the routine panel itself, step 5) — the two
  // lists can diverge on purpose, since a result card is a record of what
  // happened, not a live control over the routine.
  function removeResult(id) {
    setResults((r) => r.filter((entry) => entry.id !== id));
    setExpandedResultId((cur) => (cur === id ? null : cur));
  }

  // Every request tries the offline engine first (build prompt §3.3). A confident
  // answer needs no key; an undefined clinical term blocks plainly (B7: with an
  // in-app way to define it, not just the Definitions-sheet round-trip); a
  // per-patient question over repeating rows asks before answering; a
  // stretched value match (W2d) asks "Did you mean…?" before answering;
  // anything out of range declines and, if a key exists, is offered to Claude.
  // `storeOverride` lets a just-added definition be used immediately, without
  // waiting a render for `definitionsStore` state to update. `aliasOverride`
  // does the same for a just-confirmed "Did you mean…?" answer.
  async function runOfflineFlow(request, options, storeOverride, aliasOverride) {
    const res = runOffline(request, workbook, {
      ...options,
      definitionsStore: storeOverride || definitionsStore,
      aliasMap: aliasOverride || aliasMap,
    });
    if (res.kind === "answer") {
      // W3: an offline answer is deterministic, so it is safe to replay later
      // without the AI — record it into the routine as a "question" step
      // (original wording + the resolved match), the same way a checkup fix
      // already is.
      const answer = summarizeAnswer(res.match, res.exec);
      recordResult({
        label: `Result of: your question "${request}"`,
        answer,
        plan: res.plan,
        resultRows: res.resultRows,
        kind: "question",
        savedToRoutine: true,
      });
      setRecipe((r) => addStep(r, questionStep(request, res.match, answer)));
      return;
    }
    if (res.kind === "block") {
      if (res.missingTerms) {
        setPendingDefinitions({ missingTerms: res.missingTerms, message: res.message, request, nearest: res.nearest || [] });
      } else {
        setNotice(res.message);
      }
      return;
    }
    if (res.kind === "clarify-grain") {
      setPendingGrain({ grain: res.grain, request });
      return;
    }
    if (res.kind === "confirm-value") {
      setPendingConfirm({ phrase: res.phrase, candidates: res.candidates, via: res.via, request });
      return;
    }
    // res.kind === "decline"
    if (!apiKey) {
      setNotice(res.message);
      return;
    }
    await runViaClaude(request, res.claudeHint);
  }

  // W2d: the user picked one of the "Did you mean…?" candidates (or typed
  // something else and picked "Something else", which just cancels). Remember
  // the mapping for the rest of the session so the same stretch never asks
  // twice, then re-run the same request — it now resolves immediately via the
  // alias, with no further stretch to confirm.
  function answerConfirm(candidate) {
    const phrase = pendingConfirm?.phrase;
    const request = pendingConfirm?.request;
    setPendingConfirm(null);
    if (!phrase || !request) return;
    const next = new Map(aliasMap);
    next.set(foldKey(phrase), candidate);
    setAliasMap(next);
    runOfflineFlow(request, {}, null, next);
  }

  // B7: record the typed definition and immediately re-run the question that
  // was blocked on it — the whole point is no Excel round-trip.
  function addDefinitionAndRerun(entry) {
    const next = addDefinitionEntry(definitionsStore, entry);
    setDefinitionsStore(next);
    const request = pendingDefinitions?.request;
    setPendingDefinitions(null);
    if (request) runOfflineFlow(request, {}, next);
  }

  // P2-19: requesting a plan from Claude and running its generated transform
  // locally are two different failure domains — an API problem (bad key, rate
  // limit, no credits) vs. a bug in the generated/executed code. Catch them
  // separately so a transform failure is shown as-is instead of being
  // funneled through friendlyApiError, which frames everything as an "AI"
  // problem even when the AI call itself succeeded.
  // B11: `retryContext` (set only when this call IS the one retry) appends
  // the prior failure to the request, asking Claude for corrected code.
  async function runViaClaude(request, hint, retryContext = null) {
    setBusy(true);
    let newPlan;
    try {
      setStatus(retryContext ? "Asking Claude to fix the extraction…" : "Sending your request to Claude…");
      let userRequest = hint ? `${request}\n\n(${hint})` : request;
      if (retryContext) {
        userRequest += `\n\nThe previous transform failed with: ${retryContext.error} — return corrected code.\n\nPrevious code:\n${retryContext.failedCode}`;
      }
      // B8: recorded at send time (not on success), since the data has left
      // the browser as soon as the request goes out, whether or not Claude's
      // reply comes back.
      setAiSends((s) => [...s, { mode: privacyMode }]);
      newPlan = await requestPlan({ apiKey, model, dataContext, userRequest, onStatus: setStatus });
    } catch (err) {
      setError(friendlyApiError(err));
      setStatus("");
      setBusy(false);
      setRetryInfo(null);
      return;
    }
    try {
      setStatus("Running the extraction on your full data (inside your browser)…");
      const sheetsByName = Object.fromEntries(workbook.sheets.map((s) => [s.name, s.rows]));
      const rows = await runTransform(newPlan.transform_code, sheetsByName);
      // W3: an AI answer is not deterministic the way the offline engine is —
      // it is still shown as a results card, but it is NOT recorded into the
      // routine, since replay never calls the AI and would otherwise have to
      // guess. The card says so plainly (see ResultsListPanel).
      recordResult({
        label: `Result of: your question "${request}"`,
        answer: `${rows.length} row${rows.length === 1 ? "" : "s"}`,
        plan: newPlan,
        resultRows: rows,
        kind: "question",
        savedToRoutine: false,
      });
      setStatus("");
      setRetryInfo(null);
    } catch (err) {
      const message = err?.message || "The extraction step failed.";
      setError(message);
      setStatus("");
      // Only the first failure offers a retry — a retry that also fails just
      // shows the error, no infinite loop of AI attempts.
      setRetryInfo(retryContext ? null : { request, hint, failedCode: newPlan.transform_code, error: message });
    } finally {
      setBusy(false);
    }
  }

  // B11: re-send the same request with the prior failure appended, asking
  // for corrected code. One retry, then the offer is gone either way.
  function retryTransform() {
    if (!retryInfo) return;
    const { request, hint, failedCode, error } = retryInfo;
    setRetryInfo(null);
    setError("");
    runViaClaude(request, hint, { failedCode, error });
  }

  async function handleRun() {
    setError("");
    setNotice("");
    setPendingGrain(null);
    setPendingDefinitions(null);
    setPendingConfirm(null);
    setRetryInfo(null);
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
    setOriginalWorkbook(wb);
    setExcluded(new Set());
    setPlan(null);
    setResultRows(null);
    setResults([]); // W3: a fresh file starts a fresh "results so far" list
    setExpandedResultId(null);
    setUndoSnapshot(null);
    setError("");
    setNotice("");
    setPendingGrain(null);
    setPendingDefinitions(null);
    setPendingConfirm(null);
    setAliasMap(new Map()); // W2d: a session-level alias map, fresh per workbook
    setDefinitionsStore(emptyDefinitionsStore());
    setAiSends([]); // B8: the badge tracks this workbook's sends, not a prior file's
    setRetryInfo(null);
    setSessionLog([]);
    // W3: pre-fill the routine name from the file, e.g. "DC antibiotics — monthly".
    setRecipe(newRecipe(defaultRoutineName(wb.fileName)));
    setCheckupVersion((v) => v + 1);
  }

  // B2: a synthetic, clearly-fake workbook so a novice (or anyone with real PHI
  // they're not ready to drop in yet) can try the whole app risk-free.
  function handleTryExample() {
    handleWorkbook(buildExampleWorkbook());
  }

  // B4: "Start over" drops every change and goes back to the file as uploaded.
  function handleStartOver() {
    if (!originalWorkbook) return;
    handleWorkbook(originalWorkbook);
  }

  // B4: "Undo last apply" restores the single snapshot taken just before the
  // most recent checkup apply — the sheet, the log event it added, and the
  // recipe steps it recorded all revert together.
  function handleUndo() {
    if (!undoSnapshot) return;
    setWorkbook(undoSnapshot.workbook);
    setSessionLog(undoSnapshot.sessionLog);
    setRecipe(undoSnapshot.recipe);
    setUndoSnapshot(null);
    setPlan(null);
    setResultRows(null);
    setResults((r) => r.slice(1)); // newest-first: the undone apply's card no longer applies
    setExpandedResultId(null);
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
    setUndoSnapshot({ workbook, sessionLog, recipe });
    try {
      const { plan: fixPlan, log } = buildFixPlan(sheet, fixes);
      const rows = await runTransform(fixPlan.transform_code, { [sheet.name]: sheet.rows });
      const cleaned = deriveSheet(sheet.name, rows);
      const nextWorkbook = { ...workbook, sheets: workbook.sheets.map((s, i) => (i === 0 ? cleaned : s)) };
      setWorkbook(nextWorkbook);
      setSessionLog((l) => [...l, makeLogEvent({ fileName: workbook.fileName, sheet: sheet.name, entries: log })]);
      // Record each applied fix into the monthly recipe so it can be replayed
      // on next month's file (build prompt §7).
      setRecipe((r) => fixes.reduce((acc, fix) => addStep(acc, checkupStep(fix)), r));
      setCheckupVersion((v) => v + 1);
      recordResult({
        label: `Result of: ${fixes.length} checkup fix${fixes.length === 1 ? "" : "es"}`,
        answer: `${rows.length} row${rows.length === 1 ? "" : "s"} cleaned`,
        plan: fixPlan,
        resultRows: rows,
        kind: "checkup",
        savedToRoutine: true,
      });
      setStatus("");
    } catch (err) {
      setUndoSnapshot(null);
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
          <p className="privacy-badge">{privacyBadgeText(aiSends)}</p>
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
          {!workbook && (
            <p className="try-example-row">
              <button className="btn btn-ghost" onClick={handleTryExample}>
                Try it with example data
              </button>
              <span className="dim"> — synthetic, fake data, safe to explore. Nothing real.</span>
            </p>
          )}
          {workbook && <ColumnProfileTable sheet={workbook.sheets[0]} />}
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
            {sessionLog.length > 0 && (
              <div className="download-fixed-file">
                <button
                  className="btn btn-primary"
                  onClick={() => downloadWorkbookAsXlsx(workbook, fixedFileName(workbook.fileName))}
                >
                  Download your fixed file (.xlsx)
                </button>
                <p className="dim">
                  Same file, fixes applied. Cell colors and column widths are reset — the data
                  itself is untouched.
                </p>
              </div>
            )}
            <div className="workbook-actions">
              <button className="btn btn-ghost" onClick={handleUndo} disabled={!undoSnapshot || busy}>
                Undo last apply
              </button>
              <button className="btn btn-ghost" onClick={handleStartOver} disabled={busy}>
                Start over from the uploaded file
              </button>
            </div>
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
              workbook={workbook}
            />
            <DefinitionsPanel store={definitionsStore} onChange={setDefinitionsStore} />
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
            {pendingConfirm && (
              <ClarifyBox
                question={
                  pendingConfirm.candidates.length === 1
                    ? `Did you mean "${pendingConfirm.candidates[0].value}" in "${pendingConfirm.candidates[0].column}"?`
                    : `"${pendingConfirm.phrase}" could mean a few things — which one?`
                }
                options={pendingConfirm.candidates.map((c, i) => ({
                  value: String(i),
                  label: String(c.value),
                  detail: `in "${c.column}"`,
                }))}
                onAnswer={(i) => answerConfirm(pendingConfirm.candidates[Number(i)])}
                onCancel={() => setPendingConfirm(null)}
                cancelLabel="Something else"
              />
            )}
            {pendingDefinitions && (
              <DefinitionsEditor
                missingTerms={pendingDefinitions.missingTerms}
                message={pendingDefinitions.message}
                nearest={pendingDefinitions.nearest}
                columns={workbook.sheets[0].headers.map((h) => h.name)}
                onAdd={addDefinitionAndRerun}
                onCancel={() => setPendingDefinitions(null)}
                onSendToClaude={apiKey ? () => {
                  const request = pendingDefinitions.request;
                  setPendingDefinitions(null);
                  if (request) runViaClaude(request, "A local pre-check found an undefined clinical term and the user chose to ask the AI instead of defining it.");
                } : null}
              />
            )}
            {notice && <div className="notice-box" role="status" aria-live="polite">{notice}</div>}
            {error && (
              <div className="error-box" role="alert">
                {error}
                {retryInfo && (
                  <div className="row-end" style={{ marginTop: "0.5rem" }}>
                    <button type="button" className="btn btn-ghost" onClick={retryTransform} disabled={busy}>
                      Try again — ask Claude to fix it
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {workbook && (
          <section className="card" ref={resultsRef}>
            <h2><span className="step-label">Step 4</span> — Your results so far</h2>
            <p className="section-intro">
              Every fix you apply and every question you ask lands here as a card, newest first.
              Click a card for the full result: a table, an Excel recipe, and an RStudio script.
              Questions answered on this computer (no AI needed) are saved into your routine
              automatically — see step 5 below.
            </p>
            <ResultsListPanel
              results={results}
              expandedId={expandedResultId}
              onToggle={(id) => setExpandedResultId((cur) => (cur === id ? null : id))}
              onRemove={removeResult}
            />
          </section>
        )}

        {/* B1: optional, goal-grouped sections. Collapsed by default so a novice
            with one question isn't forced to scroll past everything else to
            find it. Pre-upload, the replay tool has nothing to number against
            yet, so it's offered separately below without step numbering. */}
        {workbook && (
          <details className="step-group">
            <summary>Monthly routine — save this cleanup as a routine, replay it next month</summary>
            <section className="card">
              <h2><span className="step-label">Step 5</span> — Save this routine</h2>
              <p className="section-intro">
                If this is a file you clean every month, save these steps as a routine and run it
                on next month's file in step 6. The checkup fixes and questions you answered above
                are recorded automatically. Optional extras — swapping names for stable codes and
                making report cards — are folded below.
              </p>
              <RecipePanel recipe={recipe} sheet={workbook.sheets[0]} onChange={setRecipe} />
            </section>
            <section className="card">
              <h2><span className="step-label">Step 6</span> — Run a saved routine on next month's file</h2>
              <p className="section-intro">
                Pick a saved routine and next month's file. The recorded steps run again, and you get a
                plain report of what happened — including anything new the rules did not cover, said
                plainly rather than guessed. Report cards, if the routine makes them, show codes only.
              </p>
              <ReplayPanel keyStore={keyStore} onKeyStore={setKeyStore} />
            </section>
          </details>
        )}

        {!workbook && (
          <section className="card">
            <h2>Already have a saved routine?</h2>
            <p className="section-intro">
              Pick a saved routine and a file to run it on. The recorded steps run again, and you
              get a plain report of what happened — including anything new the rules did not cover.
            </p>
            <ReplayPanel keyStore={keyStore} onKeyStore={setKeyStore} />
          </section>
        )}

        {workbook && (
          <details className="step-group">
            <summary>Analyze &amp; chart — compare groups, run models, make a chart</summary>
            <section className="card">
              <h2><span className="step-label">Step 7</span> — Compare two groups (statistics)</h2>
              <p className="section-intro">
                Pick a grouping column and an outcome column. The app builds the table the
                numbers come from, chooses the right test, and shows every step — so you can
                see where each number came from and check it yourself. No key needed.
                {workbook.sheets.length > 1 && (
                  <> Only the first sheet, "{workbook.sheets[0].name}", is used here.</>
                )}
              </p>
              <StatsPanel sheet={workbook.sheets[0]} />
            </section>
            <section className="card">
              <h2><span className="step-label">Step 8</span> — Advanced models (regression)</h2>
              <p className="section-intro">
                For models with several variables at once. Answer three questions first; the app
                checks whether your data can support the model and either recommends the right
                method with an RStudio script, or explains plainly why it would not be trustworthy.
                {workbook.sheets.length > 1 && (
                  <> Only the first sheet, "{workbook.sheets[0].name}", is used here.</>
                )}
              </p>
              <RegressionWizard sheet={workbook.sheets[0]} />
            </section>
            <section className="card">
              <h2><span className="step-label">Step 9</span> — Make a chart</h2>
              <p className="section-intro">
                Pick what to compare. The app recommends the one chart that fits your data, shows a
                preview here, and gives numbered steps to build the same chart in Excel.
                {workbook.sheets.length > 1 && (
                  <> Only the first sheet, "{workbook.sheets[0].name}", is used here.</>
                )}
              </p>
              <ChartsPanel sheet={workbook.sheets[0]} />
            </section>
          </details>
        )}

        {workbook && (
          <details className="step-group">
            <summary>Reshape — combine sheets, split cells, switch row grain</summary>
            <section className="card">
              <h2><span className="step-label">Step 10</span> — Combine and reshape</h2>
              <p className="section-intro">
                Common multi-step moves: find rows missing from another sheet, look up a value from a
                second sheet, split paired list cells, or switch between one row per visit and one row
                per patient. Nothing is guessed — anything that doesn't line up is shown, not dropped.
                {workbook.sheets.length > 1 && (
                  <> The first sheet, "{workbook.sheets[0].name}", is always the starting point; pick which other sheet to bring in below.</>
                )}
              </p>
              <ShelfPanel workbook={workbook} />
            </section>
          </details>
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
