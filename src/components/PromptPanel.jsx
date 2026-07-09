import { useMemo } from "react";
import { estimateTokens, estimateCostUSD } from "../logic/claude.js";
import { buildOfflineExample } from "../logic/offline/exampleQuestion.js";

// A4: these are all things the offline engine cannot compute (a
// missing-value + threshold filter, a sum-per-group, a duplicate scan, a
// text-cleanup transform) — every one of them needs the AI, hence the label.
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
  workbook,
}) {
  const tokens = estimateTokens(dataContext + prompt);
  const cost = estimateCostUSD(model, tokens);
  const tooBig = dataContext.length > 2_500_000;
  // Built from the real uploaded data and verified through the same matcher
  // the actual run uses, so this one is guaranteed to answer with no key.
  const offlineExample = useMemo(() => buildOfflineExample(workbook), [workbook]);

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
      {offlineExample && (
        <div className="example-row">
          <span className="dim example-row-label">Answered on this computer, no key needed:</span>
          <button
            type="button"
            className="example-chip example-chip-offline"
            onClick={() => setPrompt(offlineExample)}
            disabled={busy}
          >
            {offlineExample.length > 60 ? offlineExample.slice(0, 57) + "…" : offlineExample}
          </button>
        </div>
      )}
      <div className="example-row">
        <span className="dim example-row-label">Need the AI:</span>
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
          {busy ? "Working…" : "Answer my question"}
        </button>
        <span className="dim">
          Counts and shares are worked out on your computer, with no key.
          {" "}Only requests the offline engine can't handle are offered to the AI
          {" — "}
          {privacyMode === "full"
            ? "which would send every value in your spreadsheet"
            : "sending only column names and made-up examples, never your real cell contents"}
          {!needsKey ? ` · roughly ${tokens.toLocaleString()} tokens if it does (~$${cost < 0.005 ? "0.01 or less" : cost.toFixed(2)})` : ""}
        </span>
      </div>
      {needsKey && (
        <p className="hint">
          You can answer counting questions with no key at all. A key is only needed for
          requests the offline engine passes to the AI — add one with the button at the top
          right if you want that option; it stays on this computer.
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
