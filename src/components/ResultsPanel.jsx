import { useState } from "react";
import DataTable from "./DataTable.jsx";
import RstudioGuide from "./RstudioGuide.jsx";
import { downloadRowsAsXlsx, downloadRowsAsCsv, downloadText } from "../logic/workbook.js";

function CopyButton({ text, label = "Copy" }) {
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

export default function ResultsPanel({ plan, rows }) {
  const [tab, setTab] = useState("result");

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
        <button role="tab" aria-selected={tab === "result"} className={`tab ${tab === "result" ? "tab-active" : ""}`} onClick={() => setTab("result")}>
          Result table ({rows.length.toLocaleString()} rows)
        </button>
        <button role="tab" aria-selected={tab === "excel"} className={`tab ${tab === "excel" ? "tab-active" : ""}`} onClick={() => setTab("excel")}>
          Check it in Excel
        </button>
        <button role="tab" aria-selected={tab === "r"} className={`tab ${tab === "r" ? "tab-active" : ""}`} onClick={() => setTab("r")}>
          Check it in RStudio
        </button>
      </div>

      {tab === "result" && (
        <div>
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
        <div>
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
        <div>
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
