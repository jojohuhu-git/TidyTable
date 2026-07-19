import DataTable from "./DataTable.jsx";
import ResultsPanel from "./ResultsPanel.jsx";

// W3 (Step 4 — "Your results so far"): every checkup-fix apply and every
// answered question lands here as a card, newest first. Each card carries a
// one-line answer at a glance and expands to the full existing ResultsPanel
// (result table / Excel steps / R script). Questions answered on this
// computer are automatically saved into the routine below (see App.jsx and
// recipe.js questionStep); an AI answer is shown too, but is not saved into
// the routine, since replay never calls the AI.
export default function ResultsListPanel({ results, expandedId, onToggle, onRemove, onChart }) {
  if (!results.length) {
    return (
      <p className="empty-state">
        Nothing to show yet. Apply a fix in step 2, or describe what you want in step 3 and run
        it — each one will show up here as a card, and questions answered on this computer are
        saved into your routine automatically.
      </p>
    );
  }

  return (
    <ul className="results-list">
      {results.map((r) => {
        const open = expandedId === r.id;
        return (
          <li key={r.id} className={`result-card ${open ? "result-card-open" : ""}`}>
            <div className="result-card-head">
              <button
                type="button"
                className="result-card-toggle"
                aria-expanded={open}
                onClick={() => onToggle(r.id)}
              >
                <span className="result-card-label">{r.label}</span>
                <span className="result-card-answer">{r.answer}</span>
              </button>
              <span className="dim result-card-time">
                {new Date(r.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
              {r.kind === "question" && (
                r.savedToRoutine ? (
                  <span className="result-card-badge">Saved to your routine &#10003;</span>
                ) : (
                  <span className="result-card-badge result-card-badge-muted">
                    Not saved to your routine (used AI)
                  </span>
                )
              )}
              {/* Phase 8.4: a breakdown/top-N/count answer offers one-click
                  charting of the very dataset it computed — no re-typing. */}
              {r.chartRequest && onChart && (
                <button
                  type="button"
                  className="btn btn-ghost result-card-chart"
                  onClick={() => onChart(r.chartRequest)}
                >
                  Chart this
                </button>
              )}
              <button
                type="button"
                className="finding-dismiss"
                onClick={() => onRemove(r.id)}
                aria-label="Remove this result"
              >
                Remove
              </button>
            </div>
            {open && (
              r.plan && r.resultRows ? (
                <div className="result-card-body">
                  {/* Parked item 3d: rows a dedupe fix removed stay inspectable
                      here — never silently gone. Undo last apply restores them. */}
                  {r.removedRows?.length > 0 && (
                    <details className="removed-rows">
                      <summary>
                        See the {r.removedRows.length} removed row{r.removedRows.length === 1 ? "" : "s"} (undo restores them)
                      </summary>
                      <DataTable rows={r.removedRows} maxRows={50} />
                    </details>
                  )}
                  <ResultsPanel plan={r.plan} rows={r.resultRows} />
                </div>
              ) : (
                <p className="hint">
                  The full detail isn't available after a refresh — re-run this from step 3 to
                  see the result table, Excel steps, and R script again.
                </p>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}
