import { useMemo, useState } from "react";
import { analyze } from "../logic/stats/runStats.js";
import { rTTest, rChiSquare } from "../logic/rscripts/templates.js";
import { downloadText } from "../logic/workbook.js";
import { columnPickerOptions } from "../logic/columnPickerOptions.js";
import { buildStatsExamples } from "../logic/offline/examplePrompts.js";
import { CopyButton } from "./ResultsPanel.jsx";
import StepHelpPanel from "./StepHelpPanel.jsx";

// P2-22: the t-test crosscheck used to print every raw value inline, which
// is unreadable (and slow to render) for a real-sized group. Show at most
// this many and offer a copy button for the full list instead.
const CROSSCHECK_VALUE_CAP = 50;

// Step 7 (build prompt §9): compare two columns and show all the work. Pick a
// grouping column and an outcome column; the app builds the table, picks the
// right test, and lays out the pieces in the OpenEpi order so every number is
// traceable. An R script reproduces the same test.
export default function StatsPanel({ sheet }) {
  // B10: badge each option by type/cardinality and put the columns most
  // likely to fit the role first, so a novice is steered away from e.g.
  // "Patient ID" as a grouping column.
  const groupingOptions = useMemo(() => columnPickerOptions(sheet, "grouping"), [sheet]);
  const outcomeOptions = useMemo(() => columnPickerOptions(sheet, "outcome"), [sheet]);
  const examples = useMemo(() => buildStatsExamples(sheet), [sheet]);
  const [colA, setColA] = useState("");
  const [colB, setColB] = useState("");

  const result = useMemo(() => {
    if (!colA || !colB || colA === colB) return null;
    try {
      return analyze(sheet, colA, colB);
    } catch (err) {
      return { ok: false, message: err.message || "That comparison could not be run." };
    }
  }, [sheet, colA, colB]);

  const rScript = useMemo(() => {
    if (!result || !result.ok) return null;
    if (result.kind === "ttest") return rTTest(result.numCol, result.grpCol);
    if (result.kind === "contingency") return rChiSquare(result.colA, result.colB, result.useFisher);
    return null;
  }, [result]);

  return (
    <div className="stats-panel">
      <StepHelpPanel
        whatItDoes="Pick a grouping column and an outcome column and the app chooses the right statistical test, builds the table the numbers come from, and shows every step."
        cantDoYet={["Compares exactly two columns at a time.", "The grouping column needs two (or a handful of) distinct values, not a free-text or ID column."]}
        examples={examples.map((ex) => ({
          label: ex.label,
          onClick: () => { setColA(ex.colA); setColB(ex.colB); },
        }))}
      />
      <div className="stats-pickers">
        <label>
          Grouping column
          <select value={colA} onChange={(e) => setColA(e.target.value)}>
            <option value="">choose a column…</option>
            {groupingOptions.map((o) => (
              <option key={o.name} value={o.name}>{o.name} ({o.badge})</option>
            ))}
          </select>
        </label>
        <label>
          Outcome or measurement column
          <select value={colB} onChange={(e) => setColB(e.target.value)}>
            <option value="">choose a column…</option>
            {outcomeOptions.map((o) => (
              <option key={o.name} value={o.name}>{o.name} ({o.badge})</option>
            ))}
          </select>
        </label>
      </div>

      {colA && colB && colA === colB && (
        <p className="hint">Pick two different columns to compare.</p>
      )}

      {result && !result.ok && <div className="notice-box" role="status" aria-live="polite">{result.message}</div>}

      {result && result.ok && (
        <div className="stats-result">
          <p className="stats-testname"><strong>{result.testName}</strong></p>
          <ol className="stats-steps">
            {result.steps.map((step, i) => (
              <li key={i} className="stats-step">
                <h4>{step.title}</h4>
                <StepBody step={step} />
              </li>
            ))}
          </ol>

          <div className="stats-conclusion">{result.conclusion}</div>

          {rScript && (
            <details className="stats-r">
              <summary>Check it in RStudio</summary>
              <div className="summary-box"><p style={{ whiteSpace: "pre-wrap" }}>{rScript.r_run_notes}</p></div>
              <div className="row-end" style={{ margin: "0.4rem 0" }}>
                <button className="btn btn-primary" onClick={() => downloadText(rScript.script, "tidytable_stats_check.R")}>
                  Download script (.R)
                </button>
              </div>
              <pre className="code-block"><code>{rScript.script}</code></pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function StepBody({ step }) {
  if (step.kind === "note") return <p>{step.body}</p>;

  if (step.kind === "table") {
    const d = step.data;
    return (
      <table className="stats-table">
        <thead>
          <tr>
            <th>{d.rowName} \ {d.colName}</th>
            {d.colLevels.map((c) => <th key={c}>{c}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {d.rowLevels.map((rv, i) => (
            <tr key={rv}>
              <th>{rv}</th>
              {d.counts[i].map((n, j) => <td key={j}>{n}</td>)}
              <td className="stats-tot">{d.rowTot[i]}</td>
            </tr>
          ))}
          <tr>
            <th>Total</th>
            {d.colTot.map((n, j) => <td key={j} className="stats-tot">{n}</td>)}
            <td className="stats-tot">{d.grand}</td>
          </tr>
        </tbody>
      </table>
    );
  }

  if (step.kind === "expected") {
    const d = step.data;
    return (
      <>
        <table className="stats-table">
          <thead>
            <tr><th>expected</th>{d.colLevels.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {d.rowLevels.map((rv, i) => (
              <tr key={rv}><th>{rv}</th>{d.expected[i].map((e, j) => <td key={j}>{e}</td>)}</tr>
            ))}
          </tbody>
        </table>
        <p className="dim">Smallest expected count: {d.min}.</p>
      </>
    );
  }

  if (step.kind === "ttest-table") {
    const d = step.data;
    return (
      <table className="stats-table">
        <thead><tr><th>{d.grpCol}</th><th>count</th><th>average {d.numCol}</th><th>spread (SD)</th></tr></thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.group}><th>{r.group}</th><td>{r.n}</td><td>{r.mean}</td><td>{r.sd}</td></tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (step.kind === "stat") {
    const d = step.data;
    return (
      <p>
        {d.name}
        {d.statistic != null && <> = {d.statistic}</>}
        {d.df != null && <>, degrees of freedom = {d.df}</>}
        , p-value = {d.p}
      </p>
    );
  }

  if (step.kind === "effect") {
    const d = step.data;
    return <p>{d.measure}: <strong>{d.value}</strong> ({Math.round(d.level * 100)}% interval {d.lo} to {d.hi}).</p>;
  }

  if (step.kind === "effect2x2") {
    const d = step.data;
    return (
      <ul className="stats-effects">
        <li>Odds ratio for "{d.outcome}", {d.group1} vs {d.group2}: <strong>{d.or.value}</strong> ({Math.round(d.level * 100)}% interval {d.or.lo} to {d.or.hi}){d.or.corrected && <span className="dim"> — adjusted for an empty cell</span>}.</li>
        <li>Risk ratio: <strong>{d.rr.value}</strong> ({Math.round(d.level * 100)}% interval {d.rr.lo} to {d.rr.hi}){d.rr.corrected && <span className="dim"> — adjusted for an empty cell</span>}.</li>
        <li className="dim">An interval that does not cross 1 is the evidence of an association.</li>
      </ul>
    );
  }

  if (step.kind === "crosscheck2x2") {
    const { cells } = step.data;
    return (
      <p>
        Retype these four numbers into the 2×2 calculator at{" "}
        <a href="https://www.openepi.com" target="_blank" rel="noreferrer">openepi.com</a>{" "}
        to confirm: {cells.a}, {cells.b}, {cells.c}, {cells.d}.
      </p>
    );
  }

  if (step.kind === "crosscheck-ttest") {
    const d = step.data;
    const fmtList = (label, values) => {
      const shown = values.slice(0, CROSSCHECK_VALUE_CAP);
      const more = values.length - shown.length;
      return `${label} = [${shown.join(", ")}${more > 0 ? `, …and ${more} more` : ""}]`;
    };
    return (
      <div>
        <p>
          You can confirm this at <a href="https://www.openepi.com" target="_blank" rel="noreferrer">openepi.com</a>{" "}
          using the two lists of {d.numCol} values: {fmtList(d.groups[0], d.a)}, {fmtList(d.groups[1], d.b)}.
        </p>
        {(d.a.length > CROSSCHECK_VALUE_CAP || d.b.length > CROSSCHECK_VALUE_CAP) && (
          <CopyButton
            text={`${d.groups[0]} = [${d.a.join(", ")}]\n${d.groups[1]} = [${d.b.join(", ")}]`}
            label="Copy full lists"
          />
        )}
      </div>
    );
  }

  return null;
}
