import { useRef, useState } from "react";
import DataTable from "./DataTable.jsx";
import RstudioGuide from "./RstudioGuide.jsx";
import { downloadRowsAsXlsx, downloadRowsAsCsv, downloadText } from "../logic/workbook.js";
import { nextTabIndex } from "../logic/a11y/tabsKeyboard.js";

export function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

const TAB_IDS = ["result", "excel", "r"];

export default function ResultsPanel({ plan, rows }) {
  const [tab, setTab] = useState("result");
  const tabRefs = useRef([]);

  // Phase 7.4: a compound "and" question is shown as one card with each part's
  // own result stacked below a shared header — reusing this same panel per part,
  // so every part keeps its result table, Excel steps, and R script.
  if (plan.parts) {
    return (
      <div className="compound-results">
        {plan.looked_for && (
          <div className="lookedfor-box">
            <h3>What I looked for</h3>
            <p>{plan.looked_for}</p>
            <p className="dim">Each part below was answered separately on this computer.</p>
          </div>
        )}
        {plan.parts.map((part, i) => (
          <section key={i} className="compound-part">
            <ResultsPanel plan={part.plan} rows={part.rows} />
          </section>
        ))}
      </div>
    );
  }

  // B12: standard tablist keyboard support — Left/Right moves and selects,
  // wrapping at the ends; Home/End jump to the first/last tab.
  function onTabKeyDown(e, index) {
    const next = nextTabIndex(e.key, index, TAB_IDS.length);
    if (next == null) return;
    e.preventDefault();
    setTab(TAB_IDS[next]);
    tabRefs.current[next]?.focus();
  }

  const tabLabel = {
    result: `Result table (${rows.length.toLocaleString()} rows)`,
    excel: "Check it in Excel",
    r: "Check it in RStudio",
  };

  return (
    <div>
      {plan.looked_for && (
        <div className="lookedfor-box">
          <h3>What I looked for</h3>
          <p>{plan.looked_for}</p>
          <p className="dim">Check this matches your question before trusting the numbers.</p>
        </div>
      )}

      <div className="summary-box">
        <h3>{plan.engine === "offline" ? "What was done (answered on this computer)" : "What the AI did"}</h3>
        <p style={{ whiteSpace: "pre-wrap" }}>{plan.summary}</p>
      </div>

      <div className="tabs" role="tablist">
        {TAB_IDS.map((id, i) => (
          <button
            key={id}
            ref={(el) => (tabRefs.current[i] = el)}
            id={`results-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`results-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`tab ${tab === id ? "tab-active" : ""}`}
            onClick={() => setTab(id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
          >
            {tabLabel[id]}
          </button>
        ))}
      </div>

      {tab === "result" && (
        <div id="results-panel-result" role="tabpanel" aria-labelledby="results-tab-result">
          <div className="row-end" style={{ marginBottom: "0.5rem" }}>
            <button className="btn btn-primary" onClick={() => downloadRowsAsXlsx(rows)} disabled={rows.length === 0}>
              Download Excel (.xlsx)
            </button>
            <button className="btn btn-ghost" onClick={() => downloadRowsAsCsv(rows)} disabled={rows.length === 0}>
              Download CSV
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="hint">No rows matched. Read "What the AI did" above — it may explain why.</p>
          ) : (
            <DataTable rows={rows} maxRows={200} />
          )}
        </div>
      )}

      {tab === "excel" && (
        <div id="results-panel-excel" role="tabpanel" aria-labelledby="results-tab-excel">
          <p className="hint">
            Follow these steps in your original Excel file to reproduce the same result by
            hand. If your numbers match the result table, the extraction is correct.
          </p>
          <ol className="excel-steps">
            {plan.excel_steps.map((s, i) => (
              <li key={i}>
                <h4>{s.title}</h4>
                {s.where && <p className="step-where">Where: {s.where}</p>}
                {s.formula && (
                  <div className="formula-row">
                    <code className="formula">{s.formula}</code>
                    <CopyButton text={s.formula} />
                  </div>
                )}
                <p>{s.instruction}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === "r" && (
        <div id="results-panel-r" role="tabpanel" aria-labelledby="results-tab-r">
          <RstudioGuide />
          <h3 className="r-heading">Your script</h3>
          {plan.r_run_notes && (
            <div className="summary-box">
              <p style={{ whiteSpace: "pre-wrap" }}>{plan.r_run_notes}</p>
            </div>
          )}
          <div className="row-end" style={{ margin: "0.5rem 0" }}>
            <button className="btn btn-primary" onClick={() => downloadText(plan.r_script, "tidytable_check.R")}>
              Download script (.R)
            </button>
            <CopyButton text={plan.r_script} label="Copy script" />
          </div>
          <pre className="code-block"><code>{plan.r_script}</code></pre>
        </div>
      )}
    </div>
  );
}
