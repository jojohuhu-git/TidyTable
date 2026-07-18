import { useEffect, useMemo, useRef, useState } from "react";
import { buildDataset, buildCrosstabDataset, buildHistogramDataset, buildBoxDotDataset, groupSmallIntoOther, applyRankCap, describeExtreme, buildParetoData, describeParetoSummary, buildSmallMultiplesData } from "../logic/charts/aggregate.js";
import { parseChartTweak, sortDataset } from "../logic/charts/chartTweaks.js";
import { recommendChart } from "../logic/charts/advisor.js";
import { excelChartSteps } from "../logic/charts/excelChart.js";
import { buildChartTitle, buildCohortCaption } from "../logic/charts/chartTitle.js";
import { downloadChartPng } from "../logic/charts/downloadChartPng.js";
import { copyChartPng, downloadChartSvg } from "../logic/charts/exportChart.js";
import { resolveChartRequest } from "../logic/charts/textToChart.js";
import { isQualitative } from "../logic/charts/palette.js";
import { buildChartExamplePrompts } from "../logic/offline/examplePrompts.js";
import ChartPreview from "./ChartPreview.jsx";
import DataTable from "./DataTable.jsx";
import ClarifyBox from "./ClarifyBox.jsx";
import StepHelpPanel from "./StepHelpPanel.jsx";

// Step 9 (build prompt §11; W4 free-text): describe the chart in plain words and
// the app designs it — picking the column(s), aggregation, layout, and colors —
// or pick by hand with the two dropdowns below, which reflect whatever the text
// resolved to. The recommendation is opinionated; other sensible options are
// offered but collapsed. Many categories draw as a horizontal all-rows bar
// chart (never refused); grouping the smallest into "Other" is offered, never
// forced.
export default function ChartsPanel({ sheet, seed }) {
  const columns = sheet.headers.map((h) => h.name);
  // B9: the value dropdown used to list every column as "total X", including
  // text ones — picking a text column then quietly fell back to a count.
  // Filter to numeric columns so the label is never a lie.
  const numericColumns = sheet.headers.filter((h) => h.type === "number").map((h) => h.name);
  const examples = useMemo(() => buildChartExamplePrompts(sheet), [sheet]);
  const [labelCol, setLabelCol] = useState("");
  const [valueCol, setValueCol] = useState("");
  const [aggMode, setAggMode] = useState("count"); // "count" | "sum" | "average"
  const [subgroupCol, setSubgroupCol] = useState(""); // P6-1: the "split by" column — a crosstab when set
  const [layoutHint, setLayoutHint] = useState(null); // P6-1: "grouped" | "stacked" | "stacked100" from text or a manual pick
  const [distMode, setDistMode] = useState(null); // P6-2: "boxdot" when the "see the spread instead" alternative is chosen
  const [filter, setFilter] = useState(null); // W4: { column, value } from a free-text scope
  const [chosen, setChosen] = useState(null); // user override of the recommended type
  const [text, setText] = useState(""); // W4: the free-text request box
  const [textNote, setTextNote] = useState(""); // plain message when text couldn't resolve
  const [pendingConfirm, setPendingConfirm] = useState(null); // W4 middle path: { plan, summary }
  const [groupOther, setGroupOther] = useState(false); // W4: fold small values into "Other"
  const [chartRank, setChartRank] = useState(null); // Phase 4: { n, direction } from a "top N"/"most common" free-text request
  const [sortMode, setSortMode] = useState(null); // Phase 8.5: "alpha" | "value" | null (chart default)
  const [tweakText, setTweakText] = useState(""); // Phase 8.5: the "adjust the chart" box
  const [tweakLog, setTweakLog] = useState([]); // applied tweaks, in words, for replay/recipe
  const [highlightLabel, setHighlightLabel] = useState(null); // P3-3: "highlight X" — one category named
  const [referenceLine, setReferenceLine] = useState(null); // P3-3: { value, label } — average/threshold dashed line
  const [bucket, setBucket] = useState(null); // P4-2: "month" | "quarter" | null — trend-request grouping
  const [paretoOn, setParetoOn] = useState(false); // P6-3: "add cumulative % line" — off by default
  const [exportNote, setExportNote] = useState(""); // P5-1: honest result of the last copy/download action
  const svgRef = useRef(null);

  // Apply a resolved (or confirmed) plan to the pickers below, so the dropdowns
  // always reflect what the text meant and the user learns the mapping.
  function applyPlan(plan) {
    // P6-2: a histogram plan ("distribution of X") has no label column at
    // all — the empty-labelCol-plus-valueCol combination IS what baseDataset
    // below reads as "chart this one number's spread" (see baseDataset).
    setLabelCol(plan.kind === "distribution" ? "" : plan.labelCol);
    // P6-1: a crosstab plan has no value column/aggregation/rank/bucket of its
    // own (always a count of rows, split two ways) — clear those explicitly
    // so a previous single-column plan's leftovers can't bleed through.
    setSubgroupCol(plan.kind === "crosstab" ? plan.subgroupCol : "");
    setLayoutHint(plan.kind === "crosstab" ? (plan.layout || "grouped") : null);
    setValueCol(plan.kind === "crosstab" ? "" : (plan.valueCol || ""));
    setAggMode(plan.kind === "crosstab" ? "count" : (plan.aggMode || "count"));
    setDistMode(null); // a fresh plan always starts as its own default chart, never a leftover "see the spread" override
    setFilter(plan.filter || null);
    setChosen(null);
    setGroupOther(false);
    setChartRank(plan.kind === "crosstab" ? null : (plan.rank || null));
    setSortMode(null);
    setTweakLog([]);
    setHighlightLabel(null);
    setReferenceLine(null);
    setBucket(plan.kind === "crosstab" ? null : (plan.bucket || null));
    setParetoOn(false);
  }

  // Phase 8.5: apply a plain-word tweak to the chart already on screen. Each
  // recognized verb maps to one deterministic change (a cap, a re-sort) or an
  // honest note when the request is already true or not yet supported — never a
  // silent no-op. Applied tweaks are logged so a replay can keep them.
  function runTweak(text = tweakText) {
    const tweak = parseChartTweak(text, dataset);
    let note = "";
    if (tweak.kind === "topn") {
      setChartRank({ n: tweak.n, direction: chartRank?.direction === "least" ? "least" : "most" });
      note = `Only the top ${tweak.n}.`;
    } else if (tweak.kind === "sort") {
      setSortMode(tweak.mode);
      note = tweak.mode === "alpha" ? "Sorted A→Z by label." : "Sorted largest first.";
    } else if (tweak.kind === "blanks") {
      note = "Blank categories are already left out of the chart.";
    } else if (tweak.kind === "percent") {
      note = baseDataset && baseDataset.valueName === "count"
        ? "Count bars already show their percentage share, as n (%)."
        : "A percentage only makes sense for a count — switch the Value to \"count\" first.";
    } else if (tweak.kind === "flip") {
      note = "Flipping between vertical and horizontal isn't a word tweak yet — the app already lays many categories out horizontally for you.";
    } else if (tweak.kind === "highlight") {
      setHighlightLabel(tweak.label);
      note = `Highlighting "${tweak.label}".`;
    } else if (tweak.kind === "highlight-ambiguous") {
      setTextNote(`"${text}" matches more than one category (${tweak.options.join(", ")}) — type the exact one.`);
      return;
    } else if (tweak.kind === "highlight-unmatched") {
      setTextNote(`I couldn't find that category in this chart. Check the spelling of the exact label.`);
      return;
    } else if (tweak.kind === "reference") {
      if (chartType !== "bar") {
        setTextNote("A reference line is only available on bar charts right now.");
        return;
      }
      setReferenceLine({ value: tweak.value, label: tweak.label });
      note = tweak.label === "average" ? `Added a dashed line at the average (${tweak.value}).` : `Added a dashed line at ${tweak.value}.`;
    } else {
      setTextNote(`I didn't understand "${text}". Try "only top 5", "sort alphabetically", "highlight <name>", or "average".`);
      return;
    }
    if (tweak.kind === "topn" || tweak.kind === "sort" || tweak.kind === "highlight" || tweak.kind === "reference") setTweakLog((l) => [...l, note]);
    setTextNote(note);
    setTweakText("");
  }

  // W4: read the free-text box. Exact, unambiguous → apply immediately. Any
  // stretch (abbreviation, partial/fuzzy match, ambiguous column) → confirm
  // first, the same middle path Step 3 uses. Nothing resolvable → say so and
  // leave the dropdowns for the user, never guess.
  function runText(requestText = text) {
    setTextNote("");
    setPendingConfirm(null);
    const res = resolveChartRequest(requestText, sheet);
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

  // Phase 8.4: a "Chart this" click from a Step 3 answer seeds the request and
  // runs it through the same shared pipeline — the box fills in and the chart
  // draws with no re-typing. The nonce makes a repeat click re-trigger.
  useEffect(() => {
    if (!seed?.request) return;
    setText(seed.request);
    runText(seed.request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  const baseDataset = useMemo(() => {
    // P6-2: a numeric Value column picked with NO label to group it by has
    // nothing to group — the honest reading of "just this number" is "show
    // me how it's spread out", i.e. a histogram, not a silently-empty chart.
    if (!labelCol) return valueCol ? buildHistogramDataset(sheet, valueCol, { filter }) : null;
    // P6-1: a "split by" column picked (by hand or from text) makes this a
    // crosstab — always a count, never sum/average (see buildCrosstabDataset).
    if (subgroupCol) return buildCrosstabDataset(sheet, labelCol, subgroupCol, { filter });
    // P6-2: "see the spread instead" was chosen for this exact label/value
    // pair — box+dot needs the SAME two columns buildDataset below would use,
    // just kept as raw per-group values instead of one aggregated number.
    if (distMode === "boxdot" && valueCol) return buildBoxDotDataset(sheet, labelCol, valueCol, { filter });
    return buildDataset(sheet, labelCol, valueCol || null, { aggMode, filter, bucket });
  }, [sheet, labelCol, subgroupCol, valueCol, aggMode, filter, bucket, distMode]);

  const dataset = useMemo(() => {
    const grouped = baseDataset && groupOther ? groupSmallIntoOther(baseDataset) : baseDataset;
    // Phase 4: "top 5 drugs" caps the bar chart the same way it caps the Q&A
    // ranked table — sorted desc (or asc for "least common"), a tie at the
    // cutoff shown in full.
    const capped = grouped && chartRank ? applyRankCap(grouped, chartRank) : grouped;
    // Phase 8.5: a "sort alphabetically" word tweak reorders the capped set
    // (largest-first stays the default when sortMode is null).
    return capped && sortMode ? sortDataset(capped, sortMode) : capped;
  }, [baseDataset, groupOther, chartRank, sortMode]);

  const rec = useMemo(() => (dataset ? recommendChart(dataset, { requestedLayout: layoutHint }) : null), [dataset, layoutHint]);
  const chartType = chosen || rec?.type;
  // P3-3: only a bar chart draws the reference line, so it isn't carried into
  // the Excel recipe for a chart type it can't apply to.
  const emphasis = useMemo(() => ({
    highlightLabel,
    referenceLine: chartType === "bar" ? referenceLine : null,
    extremeCallout: dataset ? describeExtreme(dataset) : null,
  }), [highlightLabel, referenceLine, chartType, dataset]);
  // P6-3: "add cumulative % line" — a ranked count bar only (buildParetoData
  // itself declines a sum/average total, a time-series axis, or fewer than
  // two categories); the toggle is only offered when it's chart type "bar",
  // since the twin cumulative panel only exists in BarChart.
  const paretoCandidate = useMemo(() => (dataset ? buildParetoData(dataset) : null), [dataset]);
  const paretoEligible = chartType === "bar" && paretoCandidate != null;
  const pareto = paretoEligible && paretoOn ? paretoCandidate : null;
  const paretoSummary = pareto ? describeParetoSummary(pareto) : null;
  const steps = useMemo(
    () => (dataset && chartType && chartType !== "none" ? excelChartSteps(chartType, dataset, rec || {}, emphasis, pareto) : []),
    [dataset, chartType, rec, emphasis, pareto],
  );
  const chartTitle = useMemo(() => buildChartTitle(dataset), [dataset]);
  const qualitative = dataset && dataset.kind === "categorical" && isQualitative(dataset.points.length);

  return (
    <div className="charts-panel">
      <StepHelpPanel
        whatItDoes="Describe the chart in plain words (or pick columns by hand) and the app recommends one chart type, draws a preview, and gives numbered steps to build the same chart in Excel."
        cantDoYet={["Two-column comparisons (grouped/stacked bars) always count rows — no averages or totals across two columns yet."]}
        examples={examples.map((text) => ({
          label: text,
          onClick: () => { setText(text); runText(text); },
        }))}
      />
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
        <button type="button" className="btn btn-primary" onClick={() => runText()} disabled={!text.trim()}>
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
            <select value={labelCol} onChange={(e) => { setLabelCol(e.target.value); setChosen(null); setFilter(null); setChartRank(null); setBucket(null); setSubgroupCol(""); setLayoutHint(null); setDistMode(null); }}>
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
                setSubgroupCol(""); // P6-1: a value column and a split-by column are mutually exclusive for now
                setLayoutHint(null);
                setChosen(null);
                setChartRank(null);
                setDistMode(null);
              }}
            >
              <option value="">how many of each (count)</option>
              {numericColumns.map((c) => <option key={`sum-${c}`} value={c}>total {c}</option>)}
              {numericColumns.map((c) => <option key={`avg-${c}`} value={`avg::${c}`}>average {c}</option>)}
            </select>
          </label>
          <label>
            Split by (optional)
            <select
              value={subgroupCol}
              disabled={!labelCol || valueCol !== ""}
              onChange={(e) => {
                const v = e.target.value;
                setSubgroupCol(v);
                if (v) { setValueCol(""); setAggMode("count"); }
                setChosen(null);
                setLayoutHint(null);
                setChartRank(null);
                setDistMode(null);
              }}
            >
              <option value="">none — one column</option>
              {columns.filter((c) => c !== labelCol).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </details>
      {filter && (
        <p className="hint">{buildCohortCaption(dataset, filter)} Clear the label picker to remove this.</p>
      )}
      {valueCol === "" && !subgroupCol && numericColumns.length === 0 && labelCol && (
        <p className="hint">No numeric columns to total — showing a count of rows per {labelCol} instead.</p>
      )}
      {!labelCol && valueCol && (
        <p className="hint">No "Labels" column chosen to group by — showing the distribution (a histogram) of {valueCol} instead. Pick a Labels column above to compare {valueCol} across groups instead.</p>
      )}

      {rec && rec.type === "none" && <p className="hint">{rec.reason}</p>}

      {rec && rec.type !== "none" && (
        <div className="charts-result">
          <div className="stats-conclusion">
            <strong>Recommended: {chartTypeName(rec.type, rec.layout)}.</strong> {rec.reason}
            {rec.noPieReason && <div className="dim" style={{ marginTop: "0.3rem" }}>{rec.noPieReason}</div>}
            {rec.otherGroupedNote && <div className="dim" style={{ marginTop: "0.3rem" }}>{rec.otherGroupedNote}</div>}
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
                {[{ type: rec.type, layout: rec.layout, reason: "the recommended one" }, ...rec.alternatives].map((a, i) => {
                  // P6-1: a crosstab's alternatives are all type "bar" with a
                  // different layout — the layout, not the type, is what
                  // distinguishes "currently active" here.
                  const isActive = a.type === chartType && (a.layout || null) === (a.type === "bar" ? (rec.layout || null) : null);
                  return (
                    <li key={`${a.type}-${a.layout || i}`}>
                      <button
                        type="button"
                        className={`btn btn-ghost ${isActive ? "btn-primary" : ""}`}
                        onClick={() => {
                          setChosen(a.type);
                          setLayoutHint(a.layout || null);
                          // P6-2: "see the spread instead" / "average bar
                          // instead" toggles between the SAME label/value pair
                          // built two different ways (see baseDataset above).
                          setDistMode(a.type === "boxdot" ? "boxdot" : null);
                        }}
                      >
                        {chartTypeName(a.type, a.layout)}
                      </button>
                      <span className="dim"> — {a.reason}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <ChartPreview
            chartType={chartType}
            dataset={dataset}
            title={chartTitle}
            highlightLabel={highlightLabel}
            referenceLine={chartType === "bar" ? referenceLine : null}
            pareto={pareto}
            svgRef={svgRef}
            layout={rec.layout}
          />

          {/* P6-5: the panels cap at 12, so the FULL crosstab renders as a
              table right below — every category, nothing hidden for good. */}
          {dataset.kind === "crosstab" && chartType === "smallMultiples" && (() => {
            const sm = buildSmallMultiplesData(dataset);
            return (
              <>
                {sm.hiddenCount > 0 && (
                  <p className="hint">
                    Showing the first {sm.panels.length} of {dataset.categories.length} {dataset.labelName} categories as panels — the table below lists all of them.
                  </p>
                )}
                <DataTable
                  columns={[dataset.labelName, ...dataset.subgroups]}
                  rows={dataset.categories.map((c) => ({
                    [dataset.labelName]: c.label,
                    ...Object.fromEntries(dataset.subgroups.map((s, i) => [s, c.values[i]])),
                  }))}
                />
              </>
            );
          })()}

          {paretoEligible && (
            <label className="chart-other-toggle">
              <input type="checkbox" checked={paretoOn} onChange={(e) => setParetoOn(e.target.checked)} />
              Add cumulative % line (Pareto) — which few {labelCol || dataset.labelName} account for most of the total
            </label>
          )}
          {paretoSummary && <p className="hint">{paretoSummary}</p>}

          {/* Phase 8.5: adjust the chart in plain words. P6-1/P6-2: none of
              these verbs (top N, sort, highlight, reference line) apply to a
              crosstab or a distribution chart yet — hidden rather than
              silently no-opping while claiming success. */}
          {dataset.kind !== "crosstab" && dataset.kind !== "distribution" && (
            <div className="chart-tweak-row">
              <label className="chart-text-label">
                Adjust in words
                <input
                  className="chart-text-input"
                  value={tweakText}
                  placeholder='e.g. "only top 5" or "sort alphabetically"'
                  onChange={(e) => setTweakText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runTweak(); }}
                />
              </label>
              <button type="button" className="btn btn-ghost" onClick={() => runTweak()} disabled={!tweakText.trim()}>
                Apply
              </button>
            </div>
          )}
          {dataset.kind !== "crosstab" && dataset.kind !== "distribution" && tweakLog.length > 0 && (
            <p className="dim">Adjustments: {tweakLog.join(" ")}</p>
          )}
          {dataset.kind === "categorical" && (
            <p className="dim chart-palette-note">
              {qualitative
                ? "Colors are from a colorblind-safe palette (Okabe-Ito), so each category stays distinct for the widest audience."
                : "Colors run from dark (largest) to light (smallest) in one teal family, with the top few emphasized — matching but distinct."}
            </p>
          )}
          {/* P5-1: zero-dependency exports — copy for slides, PNG for quick
              use, SVG as the vector that scales to any poster size. Every
              copy reports its honest outcome in the note below. */}
          <div className="chart-export-row">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                const res = await copyChartPng(svgRef.current);
                setExportNote(res.message);
              }}
            >
              Copy chart (paste into slides)
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => downloadChartPng(svgRef.current, `${chartFileBase(chartTitle)}.png`)}
            >
              Download chart as image (PNG)
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => downloadChartSvg(svgRef.current, `${chartFileBase(chartTitle)}.svg`)}
            >
              Download SVG (scales to any size)
            </button>
          </div>
          {exportNote && <p className="hint" role="status">{exportNote}</p>}
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
              Not shown: {dataset.noDataGroups.join(", ")} — every value in {dataset.noDataGroups.length === 1 ? "that group" : "those groups"} was unreadable as a number, so there was nothing to {dataset.kind === "distribution" ? "plot" : "average"}. Not the same as zero.
            </p>
          )}
          {dataset.kind === "distribution" && dataset.shape === "histogram" && dataset.unreadableCount > 0 && (
            <p className="hint">
              Left out: {dataset.unreadableCount} value{dataset.unreadableCount === 1 ? "" : "s"} in "{dataset.valueName}" couldn't be read as a number, so there was nothing to plot for {dataset.unreadableCount === 1 ? "it" : "them"}. Not the same as zero.
            </p>
          )}
          {dataset.unbucketableValues?.length > 0 && (
            <p className="hint">
              Left out of the {dataset.bucket} grouping: {dataset.unbucketableValues.join(", ")} — {dataset.unbucketableValues.length === 1 ? "this value" : "these values"} in "{labelCol}" couldn't be read as a date.
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

// P5-1: one sanitized filename base shared by the PNG and SVG downloads.
function chartFileBase(chartTitle) {
  return chartTitle.replace(/[^\w -]/g, "").trim() || "chart";
}

const CROSSTAB_LAYOUT_CHART_NAME = {
  grouped: "grouped bar chart",
  stacked: "stacked bar chart",
  stacked100: "100% stacked bar chart",
};

function chartTypeName(type, layout) {
  if (type === "bar" && layout === "horizontal") return "horizontal bar chart";
  if (type === "bar" && CROSSTAB_LAYOUT_CHART_NAME[layout]) return CROSSTAB_LAYOUT_CHART_NAME[layout];
  return { bar: "bar chart", line: "line chart", pie: "pie chart", scatter: "scatter plot", histogram: "histogram", boxdot: "box and dot plot", smallMultiples: "small multiples" }[type] || type;
}
