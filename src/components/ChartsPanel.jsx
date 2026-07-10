import { useMemo, useRef, useState } from "react";
import { buildDataset, groupSmallIntoOther, applyRankCap } from "../logic/charts/aggregate.js";
import { recommendChart } from "../logic/charts/advisor.js";
import { excelChartSteps } from "../logic/charts/excelChart.js";
import { buildChartTitle } from "../logic/charts/chartTitle.js";
import { downloadChartPng } from "../logic/charts/downloadChartPng.js";
import { resolveChartRequest } from "../logic/charts/textToChart.js";
import { isQualitative } from "../logic/charts/palette.js";
import ChartPreview from "./ChartPreview.jsx";
import ClarifyBox from "./ClarifyBox.jsx";

// Step 9 (build prompt §11; W4 free-text): describe the chart in plain words and
// the app designs it — picking the column(s), aggregation, layout, and colors —
// or pick by hand with the two dropdowns below, which reflect whatever the text
// resolved to. The recommendation is opinionated; other sensible options are
// offered but collapsed. Many categories draw as a horizontal all-rows bar
// chart (never refused); grouping the smallest into "Other" is offered, never
// forced.
export default function ChartsPanel({ sheet }) {
  const columns = sheet.headers.map((h) => h.name);
  // B9: the value dropdown used to list every column as "total X", including
  // text ones — picking a text column then quietly fell back to a count.
  // Filter to numeric columns so the label is never a lie.
  const numericColumns = sheet.headers.filter((h) => h.type === "number").map((h) => h.name);
  const [labelCol, setLabelCol] = useState("");
  const [valueCol, setValueCol] = useState("");
  const [aggMode, setAggMode] = useState("count"); // "count" | "sum" | "average"
  const [filter, setFilter] = useState(null); // W4: { column, value } from a free-text scope
  const [chosen, setChosen] = useState(null); // user override of the recommended type
  const [text, setText] = useState(""); // W4: the free-text request box
  const [textNote, setTextNote] = useState(""); // plain message when text couldn't resolve
  const [pendingConfirm, setPendingConfirm] = useState(null); // W4 middle path: { plan, summary }
  const [groupOther, setGroupOther] = useState(false); // W4: fold small values into "Other"
  const [chartRank, setChartRank] = useState(null); // Phase 4: { n, direction } from a "top N"/"most common" free-text request
  const svgRef = useRef(null);

  // Apply a resolved (or confirmed) plan to the pickers below, so the dropdowns
  // always reflect what the text meant and the user learns the mapping.
  function applyPlan(plan) {
    setLabelCol(plan.labelCol);
    setValueCol(plan.valueCol || "");
    setAggMode(plan.aggMode);
    setFilter(plan.filter || null);
    setChosen(null);
    setGroupOther(false);
    setChartRank(plan.rank || null);
  }

  // W4: read the free-text box. Exact, unambiguous → apply immediately. Any
  // stretch (abbreviation, partial/fuzzy match, ambiguous column) → confirm
  // first, the same middle path Step 3 uses. Nothing resolvable → say so and
  // leave the dropdowns for the user, never guess.
  function runText() {
    setTextNote("");
    setPendingConfirm(null);
    const res = resolveChartRequest(text, sheet);
    if (res.status !== "resolved") {
      setTextNote(res.message);
      return;
    }
    if (res.confidence === "stretched") {
      setPendingConfirm({ plan: res, summary: res.lookedFor });
      return;
    }
    applyPlan(res);
    if (res.ignored) setTextNote(`Charting ${res.lookedFor} I couldn't place "${res.ignored}", so it was left out — add it with the pickers below if it matters.`);
  }

  const baseDataset = useMemo(() => {
    if (!labelCol) return null;
    return buildDataset(sheet, labelCol, valueCol || null, { aggMode, filter });
  }, [sheet, labelCol, valueCol, aggMode, filter]);

  const dataset = useMemo(() => {
    const grouped = baseDataset && groupOther ? groupSmallIntoOther(baseDataset) : baseDataset;
    // Phase 4: "top 5 drugs" caps the bar chart the same way it caps the Q&A
    // ranked table — sorted desc (or asc for "least common"), a tie at the
    // cutoff shown in full.
    return grouped && chartRank ? applyRankCap(grouped, chartRank) : grouped;
  }, [baseDataset, groupOther, chartRank]);

  const rec = useMemo(() => (dataset ? recommendChart(dataset) : null), [dataset]);
  const chartType = chosen || rec?.type;
  const steps = useMemo(
    () => (dataset && chartType && chartType !== "none" ? excelChartSteps(chartType, dataset, rec || {}) : []),
    [dataset, chartType, rec],
  );
  const chartTitle = useMemo(() => buildChartTitle(dataset), [dataset]);
  const qualitative = dataset && dataset.kind === "categorical" && isQualitative(dataset.points.length);

  return (
    <div className="charts-panel">
      {/* W4: describe the chart in words; the app designs it. */}
      <div className="chart-text-row">
        <label className="chart-text-label">
          Describe the chart
          <input
            className="chart-text-input"
            value={text}
            placeholder="e.g. organisms in urine by number of patients"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runText(); }}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={runText} disabled={!text.trim()}>
          Make this chart
        </button>
      </div>
      {textNote && <p className="hint" role="status">{textNote}</p>}
      {pendingConfirm && (
        <ClarifyBox
          question={`Did you mean: ${pendingConfirm.summary}`}
          options={[{ value: "yes", label: "Yes, chart that", detail: pendingConfirm.summary }]}
          onAnswer={() => { applyPlan(pendingConfirm.plan); setPendingConfirm(null); }}
          onCancel={() => setPendingConfirm(null)}
          cancelLabel="No, I'll pick by hand"
        />
      )}

      <details className="chart-manual" open={!text && !labelCol ? undefined : true}>
        <summary>…or pick by hand</summary>
        <div className="stats-pickers">
          <label>
            Labels (what to compare)
            <select value={labelCol} onChange={(e) => { setLabelCol(e.target.value); setChosen(null); setFilter(null); setChartRank(null); }}>
              <option value="">choose a column…</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Value
            <select
              value={aggMode === "average" && valueCol ? `avg::${valueCol}` : valueCol}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("avg::")) { setValueCol(v.slice(5)); setAggMode("average"); }
                else if (v) { setValueCol(v); setAggMode("sum"); }
                else { setValueCol(""); setAggMode("count"); }
                setChosen(null);
                setChartRank(null);
              }}
            >
              <option value="">how many of each (count)</option>
              {numericColumns.map((c) => <option key={`sum-${c}`} value={c}>total {c}</option>)}
              {numericColumns.map((c) => <option key={`avg-${c}`} value={`avg::${c}`}>average {c}</option>)}
            </select>
          </label>
        </div>
      </details>
      {filter && (
        <p className="hint">Only counting rows where "{filter.column}" is "{filter.value}". Clear the label picker to remove this.</p>
      )}
      {valueCol === "" && numericColumns.length === 0 && labelCol && (
        <p className="hint">No numeric columns to total — showing a count of rows per {labelCol} instead.</p>
      )}

      {rec && rec.type === "none" && <p className="hint">{rec.reason}</p>}

      {rec && rec.type !== "none" && (
        <div className="charts-result">
          <div className="stats-conclusion">
            <strong>Recommended: {chartTypeName(rec.type, rec.layout)}.</strong> {rec.reason}
            {rec.noPieReason && <div className="dim" style={{ marginTop: "0.3rem" }}>{rec.noPieReason}</div>}
          </div>

          {rec.offerGroupOther && (
            <label className="chart-other-toggle">
              <input type="checkbox" checked={groupOther} onChange={(e) => setGroupOther(e.target.checked)} />
              Group the smallest categories into one "Other" bar (optional — uncheck to show every category)
            </label>
          )}

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

          <ChartPreview chartType={chartType} dataset={dataset} title={chartTitle} svgRef={svgRef} layout={rec.layout} />
          {dataset.kind === "categorical" && (
            <p className="dim chart-palette-note">
              {qualitative
                ? "Colors are from a colorblind-safe palette (Okabe-Ito), so each category stays distinct for the widest audience."
                : "Colors run from dark (largest) to light (smallest) in one teal family, with the top few emphasized — matching but distinct."}
            </p>
          )}
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
          {dataset.rankRequestedN != null && dataset.rankShown > dataset.rankRequestedN && (
            <p className="hint">
              Asked for the top {dataset.rankRequestedN}; showing {dataset.rankShown} because of a tie at the cutoff.
            </p>
          )}
          {dataset.noDataGroups?.length > 0 && (
            <p className="hint">
              Not shown: {dataset.noDataGroups.join(", ")} — every value in {dataset.noDataGroups.length === 1 ? "that group" : "those groups"} was unreadable as a number, so there was nothing to average. Not the same as zero.
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

function chartTypeName(type, layout) {
  if (type === "bar" && layout === "horizontal") return "horizontal bar chart";
  return { bar: "bar chart", line: "line chart", pie: "pie chart", scatter: "scatter plot" }[type] || type;
}
