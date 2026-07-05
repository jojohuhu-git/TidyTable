import { estimateTokens, estimateCostUSD } from "../logic/claude.js";

const EXAMPLES = [
  "Pull out everyone over 65 who is missing a value in the vaccination date column.",
  "Give me total sales per region per month, sorted from highest to lowest.",
  "Find duplicate patient IDs and show me every row involved.",
  "Clean up the phone number column into the format (555) 123-4567 and flag ones that can't be fixed.",
];

export default function PromptPanel({
  prompt,
  setPrompt,
  onRun,
  busy,
  status,
  canRun,
  needsKey,
  dataContext,
  model,
  privacyMode,
}) {
  const tokens = estimateTokens(dataContext + prompt);
  const cost = estimateCostUSD(model, tokens);
  const tooBig = dataContext.length > 2_500_000;

  return (
    <div>
      <textarea
        className="prompt-box"
        rows={4}
        placeholder={`For example: "${EXAMPLES[0]}"`}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
      />
      <div className="example-row">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="example-chip"
            onClick={() => setPrompt(ex)}
            disabled={busy}
          >
            {ex.length > 60 ? ex.slice(0, 57) + "…" : ex}
          </button>
        ))}
      </div>

      <div className="run-row">
        <button className="btn btn-primary btn-big" onClick={onRun} disabled={!canRun || busy || tooBig}>
          {busy ? "Working…" : "Pull my data"}
        </button>
        <span className="dim">
          {privacyMode === "full"
            ? "This sends every value in your spreadsheet to the AI"
            : "This sends only column names and made-up examples — never your real cell contents"}
          {" · "}roughly {tokens.toLocaleString()} tokens (~${cost < 0.005 ? "0.01 or less" : cost.toFixed(2)} of AI credit)
        </span>
      </div>
      {needsKey && (
        <p className="hint">
          Running a request uses the AI, which needs your own key. Add one with the button
          at the top right — it stays on this computer.
        </p>
      )}
      {tooBig && (
        <p className="warn">
          This spreadsheet is too large to send in full. Switch to "Column names + 10 sample
          rows" above — the extraction still runs on all of your data, locally.
        </p>
      )}
      {busy && status && <p className="status-line">{status}</p>}
    </div>
  );
}
