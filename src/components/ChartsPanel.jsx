import { useMemo, useRef, useState } from "react";
import { buildDataset } from "../logic/charts/aggregate.js";
import { recommendChart } from "../logic/charts/advisor.js";
import { excelChartSteps } from "../logic/charts/excelChart.js";
import { buildChartTitle } from "../logic/charts/chartTitle.js";
import { downloadChartPng } from "../logic/charts/downloadChartPng.js";
import ChartPreview from "./ChartPreview.jsx";

// Step 9 (build prompt §11): pick what to chart, and the app recommends ONE chart
// that fits the shape of the data, previews it, and gives numbered steps to make
// the same chart in Excel. The recommendation is opinionated; other sensible
// options are offered but collapsed.
export default function ChartsPanel({ sheet }) {
  const columns = sheet.headers.map((h) => h.name);
  // B9: the value dropdown used to list every column as "total X", including
  // text ones — picking a text column then quietly fell back to a count.
  // Filter to numeric columns so the label is never a lie.
  const numericColumns = sheet.headers.filter((h) => h.type === "number").map((h) => h.name);
  const [labelCol, setLabelCol] = useState("");
  const [valueCol, setValueCol] = useState("");
  const [chosen, setChosen] = useState(null); // user override of the recommended type
  const svgRef = useRef(null);

  const dataset = useMemo(() => {
    if (!labelCol) return null;
    return buildDataset(sheet, labelCol, valueCol || null);
  }, [sheet, labelCol, valueCol]);

  const rec = useMemo(() => (dataset ? recommendChart(dataset) : null), [dataset]);
  const chartType = chosen || rec?.type;
  const steps = useMemo(
    () => (dataset && chartType && chartType !== "none" ? excelChartSteps(chartType, dataset) : []),
    [dataset, chartType],
  );
  const chartTitle = useMemo(() => buildChartTitle(dataset), [dataset]);

  return (
    <div className="charts-panel">
      <div className="stats-pickers">
        <label>
          Labels (what to compare)
          <select value={labelCol} onChange={(e) => { setLabelCol(e.target.value); setChosen(null); }}>
            <option value="">choose a column…</option>
            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Value
          <select value={valueCol} onChange={(e) => { setValueCol(e.target.value); setChosen(null); }}>
            <option value="">how many of each (count)</option>
            {numericColumns.map((c) => <option key={c} value={c}>total {c}</option>)}
          </select>
        </label>
      </div>
      {valueCol === "" && numericColumns.length === 0 && labelCol && (
        <p className="hint">No numeric columns to total — showing a count of rows per {labelCol} instead.</p>
      )}

      {rec && rec.type === "none" && <p className="hint">{rec.reason}</p>}

      {rec && rec.type !== "none" && (
        <div className="charts-result">
          <div className="stats-conclusion">
            <strong>Recommended: {chartTypeName(rec.type)}.</strong> {rec.reason}
            {rec.noPieReason && <div className="dim" style={{ marginTop: "0.3rem" }}>{rec.noPieReason}</div>}
          </div>

          {rec.alternatives?.length > 0 && (
            <details className="charts-alts">
              <summary>Other options</summary>
              <ul>
                {[{ type: rec.type, reason: "the recommended one" }, ...rec.alternatives].map((a) => (
                  <li key={a.type}>
                    <button
                      type="button"
                      className={`btn btn-ghost ${chartType === a.type ? "btn-primary" : ""}`}
                      onClick={() => setChosen(a.type)}
                    >
                      {chartTypeName(a.type)}
                    </button>
                    <span className="dim"> — {a.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <ChartPreview chartType={chartType} dataset={dataset} title={chartTitle} svgRef={svgRef} />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => downloadChartPng(svgRef.current, `${chartTitle.replace(/[^\w -]/g, "").trim() || "chart"}.png`)}
          >
            Download chart as image
          </button>
          {dataset.sampled && (
            <p className="hint">
              Showing a sample of {dataset.points.length.toLocaleString()} of {dataset.totalPoints.toLocaleString()} points, spread evenly through the data, so the preview stays readable and fast.
            </p>
          )}

          <h4 className="charts-steps-h">Make this chart in Excel</h4>
          <ol className="excel-steps">
            {steps.map((s, i) => (
              <li key={i}>
                <h4>{s.title}</h4>
                <p>{s.instruction}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function chartTypeName(type) {
  return { bar: "bar chart", line: "line chart", pie: "pie chart", scatter: "scatter plot" }[type] || type;
}
