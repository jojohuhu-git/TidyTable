import { useEffect, useMemo, useRef, useState } from "react";
import { buildDataset, buildCrosstabDataset, buildHistogramDataset, buildBoxDotDataset, groupSmallIntoOther, applyRankCap, describeExtreme, buildParetoData, describeParetoSummary, buildSmallMultiplesData } from "../logic/charts/aggregate.js";
import { parseChartTweak, sortDataset } from "../logic/charts/chartTweaks.js";
import { recommendChart } from "../logic/charts/advisor.js";
import { excelChartSteps } from "../logic/charts/excelChart.js";
import { buildChartTitle, buildCohortCaption, buildFigureCaption } from "../logic/charts/chartTitle.js";
import { downloadChartPng } from "../logic/charts/downloadChartPng.js";
import { copyChartPng, downloadChartSvg } from "../logic/charts/exportChart.js";
import { EXPORT_PRESETS, computePresetExport } from "../logic/charts/exportPresets.js";
import { resolveChartRequest, stagesToFilterGroup } from "../logic/charts/textToChart.js";
import { previewFilterCount, previewGroupCounts } from "../logic/charts/filterGroups.js";
import { summarizePlan } from "../logic/charts/planSummary.js";
import { isQualitative } from "../logic/charts/palette.js";
import { buildChartExamplePrompts, buildCrosstabExamplePrompts } from "../logic/offline/examplePrompts.js";
import ChartPreview from "./ChartPreview.jsx";
import DataTable from "./DataTable.jsx";
import { CopyButton } from "./ResultsPanel.jsx";
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
  // Parked item 1(c): crosstab + cohort-filtered chips. Each carries an
  // already-resolved plan (verified once at build time) — clicking applies it
  // directly and never re-parses text.
  const crosstabExamples = useMemo(() => buildCrosstabExamplePrompts(sheet), [sheet]);
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
  const [declineAlternatives, setDeclineAlternatives] = useState([]); // parked item 1(b): clickable resolved plans offered on a partial parse
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
  const [exportPreset, setExportPreset] = useState("slide"); // P5-2: what the PNG download is sized for
  const [posterInches, setPosterInches] = useState(8); // P5-2: poster width, in inches
  const [figTitle, setFigTitle] = useState(""); // P5-3: editable figure title (empty = the automatic one)
  const [figFootnote, setFigFootnote] = useState(""); // P5-3: footnote drawn on the chart itself
  const [grayscale, setGrayscale] = useState(false); // P5-3: print-safe single-hue palette
  const svgRef = useRef(null);

  // Item 7 (plan-echo builder): a separate draft/confirm layer, not a
  // replacement for the pickers above — the picker state above still drives
  // baseDataset exactly as before; this panel only fans its confirmed plan
  // into that same state on Run (see runConfirmedPlan), the same way
  // free-text applyPlan already does.
  const [planOpen, setPlanOpen] = useState(false);
  const [planFilterGroups, setPlanFilterGroups] = useState([[]]); // AND-within-group, OR-across-groups; [[]] = no filter
  const [planMeasureCol, setPlanMeasureCol] = useState("");
  const [planAggMode, setPlanAggMode] = useState("count"); // "count" | "sum" | "average" | "median"
  const [planGroupCols, setPlanGroupCols] = useState([]); // 0, 1, or 2 column names
  const [planSortChoice, setPlanSortChoice] = useState(""); // "" | "label-asc" | "value-desc"
  const [confirmedPlan, setConfirmedPlan] = useState(null); // the un-flattened plan object, for the Excel/R generators

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
    setDeclineAlternatives([]);
    setChosen(null);
    setGroupOther(false);
    setChartRank(plan.kind === "crosstab" ? null : (plan.rank || null));
    setSortMode(null);
    setTweakLog([]);
    setHighlightLabel(null);
    setReferenceLine(null);
    setBucket(plan.kind === "crosstab" ? null : (plan.bucket || null));
    setParetoOn(false);
    // P5-3: a fresh chart request must not inherit the previous figure's
    // hand-written title/footnote — a stale caption on a new chart lies.
    setFigTitle("");
    setFigFootnote("");
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
    setDeclineAlternatives([]);
    const res = resolveChartRequest(requestText, sheet);
    if (res.status !== "resolved") {
      setTextNote(res.message);
      // Parked item 1(b): a partial two-column parse comes back with 2-3
      // already-resolved alternatives — offer them as clickable chips rather
      // than leaving the owner to guess the real column name.
      if (res.alternatives?.length) setDeclineAlternatives(res.alternatives);
      // Item 7: a cohort the quick-chart pipeline declines as too complex
      // (more than one condition) is exactly what the plan-echo panel CAN
      // express — pre-fill it from the same stages and open it, instead of
      // the request just being lost to a decline message.
      if (res.reason === "complex-filter" && res.stages?.length) prefillPlanFromResolved(res, { open: true });
      return;
    }
    if (res.confidence === "stretched") {
      setPendingConfirm({ plan: res, summary: res.lookedFor });
      return;
    }
    applyPlan(res);
    if (res.ignored) setTextNote(`Charting ${res.lookedFor} I couldn't place "${res.ignored}", so it was left out — add it with the pickers below if it matters.`);
    // Item 7: quietly keep the plan-echo panel in sync too (not force-opened
    // — the quick chart already drew), so it's ready to edit/confirm if the
    // owner opens it.
    if (res.stages) prefillPlanFromResolved(res, { open: false });
  }

  // Item 7: turn a resolved (or too-complex-to-quick-chart) free-text result
  // into the plan-echo panel's draft state. Anything the parser can't
  // confidently place is left empty for the owner to fill by hand — never
  // guessed (stagesToFilterGroup already drops non-equality stages; a
  // crosstab/histogram/no-groupColumn result simply leaves the matching slot
  // untouched below).
  function prefillPlanFromResolved(res, { open } = {}) {
    setPlanFilterGroups(stagesToFilterGroup(res.stages || []));
    if (res.valueCol && (res.aggMode === "sum" || res.aggMode === "average")) {
      setPlanMeasureCol(res.valueCol);
      setPlanAggMode(res.aggMode);
    } else {
      setPlanMeasureCol("");
      setPlanAggMode("count");
    }
    const cols = [];
    if (res.labelCol) cols.push(res.labelCol);
    if (res.subgroupCol) cols.push(res.subgroupCol);
    setPlanGroupCols(cols);
    setPlanSortChoice("");
    setConfirmedPlan(null);
    if (open) setPlanOpen(true);
  }

  // Item 7: fold the draft picker state above into the one plan object
  // summarizePlan/the Run action/the Excel+R generators all read.
  const draftPlan = useMemo(() => ({
    filterGroups: planFilterGroups,
    measure: { col: planMeasureCol || null, aggMode: planAggMode },
    groupCols: planGroupCols,
    sort: planSortChoice ? {
      by: planSortChoice.startsWith("label") ? (planGroupCols[0] || "") : (planMeasureCol || (planAggMode === "count" ? "count" : planAggMode)),
      direction: planSortChoice.endsWith("asc") ? "asc" : "desc",
    } : null,
  }), [planFilterGroups, planMeasureCol, planAggMode, planGroupCols, planSortChoice]);

  const planSummaryLine = useMemo(() => summarizePlan(draftPlan), [draftPlan]);
  const planMatchCount = useMemo(() => previewFilterCount(sheet, planFilterGroups), [sheet, planFilterGroups]);
  const planGroupPreview = useMemo(
    () => (planGroupCols.length ? previewGroupCounts(sheet, planFilterGroups, planGroupCols) : []),
    [sheet, planFilterGroups, planGroupCols],
  );

  function updateCondition(gi, ci, patch) {
    setPlanFilterGroups((groups) => groups.map((g, i) => (i !== gi ? g : g.map((c, j) => (j !== ci ? c : { ...c, ...patch })))));
  }
  function addCondition(gi) {
    setPlanFilterGroups((groups) => groups.map((g, i) => (i !== gi ? g : [...g, { column: "", value: "" }])));
  }
  function removeCondition(gi, ci) {
    setPlanFilterGroups((groups) => groups.map((g, i) => (i !== gi ? g : g.filter((_, j) => j !== ci))));
  }
  function addGroup() {
    setPlanFilterGroups((groups) => [...groups, []]);
  }
  function removeGroup(gi) {
    setPlanFilterGroups((groups) => (groups.length <= 1 ? groups : groups.filter((_, i) => i !== gi)));
  }
  function distinctValuesFor(col) {
    if (!col) return [];
    const seen = new Set();
    const out = [];
    for (const r of sheet.rows) {
      const v = r[col];
      if (v == null || String(v).trim() === "") continue;
      const s = String(v);
      if (!seen.has(s)) { seen.add(s); out.push(s); }
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  function setGroupCol1(v) {
    setPlanGroupCols((cols) => {
      if (!v) return [];
      return cols[1] && cols[1] !== v ? [v, cols[1]] : [v];
    });
  }
  function setGroupCol2(v) {
    setPlanGroupCols((cols) => (v ? [cols[0], v] : cols[0] ? [cols[0]] : []));
  }

  // Item 7 Run: the confirmed plan drives the SAME picker state/dispatch
  // baseDataset already uses (see below) — filter.groups is understood by
  // aggregate.js's applyFilter automatically. Also keeps the un-flattened
  // plan object (confirmedPlan) for the Excel/R generators, since the OR-
  // group structure and the sort spec are lossy once flattened into the
  // legacy single-filter/sortMode shape.
  function runConfirmedPlan() {
    const groupsReal = planFilterGroups.filter((g) => g.length > 0);
    setConfirmedPlan(draftPlan);
    setLabelCol(planGroupCols[0] || "");
    setSubgroupCol(planGroupCols[1] || "");
    setLayoutHint(planGroupCols[1] ? "grouped" : null);
    setValueCol(planMeasureCol || "");
    setAggMode(planAggMode);
    setDistMode(null);
    setFilter(groupsReal.length ? { groups: planFilterGroups } : null);
    setDeclineAlternatives([]);
    setChosen(null);
    setGroupOther(false);
    setChartRank(null);
    // Item 7: sort is now part of the saved/confirmed plan, not a separate
    // post-hoc toggle — reuses the existing sortMode/sortDataset machinery
    // (only "alpha"/"value" exist today) rather than building a second sort
    // implementation; a crosstab (2 group columns) doesn't reorder visually
    // yet (sortDataset only handles the categorical shape) but the sort is
    // still saved into confirmedPlan for the Excel/R surfaces.
    setSortMode(planSortChoice === "label-asc" ? "alpha" : planSortChoice === "value-desc" ? "value" : null);
    setTweakLog([]);
    setHighlightLabel(null);
    setReferenceLine(null);
    setBucket(null);
    setParetoOn(false);
    setFigTitle("");
    setFigFootnote("");
    setText("");
    setTextNote("");
    setPendingConfirm(null);
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
    // Item 7: a crosstab can now carry a real measure (valueCol/aggMode) from
    // a confirmed plan-echo plan instead of always counting rows — passing
    // an empty valueCol/"count" aggMode (the quick-chart/example-chip
    // default) is a no-op in buildCrosstabDataset, so nothing here changes
    // for any existing count-only crosstab caller.
    if (subgroupCol) return buildCrosstabDataset(sheet, labelCol, subgroupCol, { filter, valueCol: valueCol || null, aggMode });
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
  // P5-3: the title on the figure — the user's own if typed, else automatic.
  const effectiveTitle = figTitle.trim() || chartTitle;
  const figureCaption = dataset ? buildFigureCaption({
    title: effectiveTitle,
    footnote: figFootnote.trim(),
    cohortCaption: filter ? buildCohortCaption(dataset, filter) : "",
  }) : "";
  const qualitative = dataset && dataset.kind === "categorical" && isQualitative(dataset.points.length) && !grayscale;

  return (
    <div className="charts-panel">
      <StepHelpPanel
        whatItDoes="Describe the chart in plain words (or pick columns by hand) and the app recommends one chart type, draws a preview, and gives numbered steps to build the same chart in Excel."
        cantDoYet={["Two-column comparisons (grouped/stacked bars) always count rows — no averages or totals across two columns yet."]}
        examples={[
          ...examples.map((text) => ({
            label: text,
            onClick: () => { setText(text); runText(text); },
          })),
          // Parked item 1(c): the plan is already resolved — apply it
          // directly, never re-run it through the free-text parser.
          ...crosstabExamples.map((ex) => ({
            label: ex.caption,
            onClick: () => { setText(ex.caption); setTextNote(""); setPendingConfirm(null); applyPlan(ex.plan); },
          })),
        ]}
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
      {declineAlternatives.length > 0 && (
        <div className="step-help-examples">
          {declineAlternatives.map((alt) => (
            <button
              key={alt.label}
              type="button"
              className="example-chip"
              onClick={() => { setText(alt.label); setTextNote(""); applyPlan(alt.plan); }}
            >
              {alt.label}
            </button>
          ))}
        </div>
      )}
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

      {/* Item 7: the plan-echo builder — "surefire accuracy" for
          multi-condition requests a single sentence can't reliably parse.
          Reuses the same select markup as the pickers above; the new pieces
          are the AND/OR condition groups, the median measure option,
          two-column grouped measures, the saved sort, and the live preview
          + literal summary line shown before Run. */}
      <details className="plan-echo-panel" open={planOpen} onToggle={(e) => setPlanOpen(e.target.open)}>
        <summary>Build a surefire plan (multiple conditions, median, two-column grouping)</summary>

        <div className="plan-echo-section">
          <h4>Rows kept</h4>
          {planFilterGroups.map((group, gi) => (
            <div key={gi} className="plan-echo-group">
              {group.map((cond, ci) => (
                <div key={ci} className="plan-echo-condition">
                  <label>
                    Column
                    <select
                      value={cond.column}
                      onChange={(e) => updateCondition(gi, ci, { column: e.target.value, value: "" })}
                    >
                      <option value="">choose a column…</option>
                      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>
                    is
                    <select
                      value={cond.value}
                      disabled={!cond.column}
                      onChange={(e) => updateCondition(gi, ci, { value: e.target.value })}
                    >
                      <option value="">choose a value…</option>
                      {distinctValuesFor(cond.column).map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn btn-ghost" onClick={() => removeCondition(gi, ci)}>
                    Remove condition
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost" onClick={() => addCondition(gi)}>
                + Add condition (AND)
              </button>
              {planFilterGroups.length > 1 && (
                <button type="button" className="btn btn-ghost" onClick={() => removeGroup(gi)}>
                  Remove this group
                </button>
              )}
              {gi < planFilterGroups.length - 1 && <p className="dim plan-echo-or">— or —</p>}
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={addGroup}>
            + Add another group (OR)
          </button>
          <p className="hint">{planMatchCount} row{planMatchCount === 1 ? "" : "s"} match.</p>
        </div>

        <div className="plan-echo-section">
          <label>
            Measure
            <select
              value={
                planAggMode === "count" ? ""
                  : planAggMode === "average" ? `avg::${planMeasureCol}`
                    : planAggMode === "median" ? `median::${planMeasureCol}`
                      : planMeasureCol
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("avg::")) { setPlanMeasureCol(v.slice(5)); setPlanAggMode("average"); }
                else if (v.startsWith("median::")) { setPlanMeasureCol(v.slice(8)); setPlanAggMode("median"); }
                else if (v) { setPlanMeasureCol(v); setPlanAggMode("sum"); }
                else { setPlanMeasureCol(""); setPlanAggMode("count"); }
              }}
            >
              <option value="">how many of each (count)</option>
              {numericColumns.map((c) => <option key={`p-sum-${c}`} value={c}>total {c}</option>)}
              {numericColumns.map((c) => <option key={`p-avg-${c}`} value={`avg::${c}`}>average {c}</option>)}
              {numericColumns.map((c) => <option key={`p-median-${c}`} value={`median::${c}`}>median {c}</option>)}
            </select>
          </label>
        </div>

        <div className="plan-echo-section">
          <label>
            Grouped by
            <select value={planGroupCols[0] || ""} onChange={(e) => setGroupCol1(e.target.value)}>
              <option value="">choose a column…</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            and (optional second column — a real measure now works here too)
            <select value={planGroupCols[1] || ""} disabled={!planGroupCols[0]} onChange={(e) => setGroupCol2(e.target.value)}>
              <option value="">none — one column</option>
              {columns.filter((c) => c !== planGroupCols[0]).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {planGroupCols.length > 0 && planGroupPreview.length > 0 && (
            <ul className="plan-echo-preview-list">
              {planGroupPreview.map((g) => <li key={g.label}>{g.label}: n={g.n}</li>)}
            </ul>
          )}
        </div>

        <div className="plan-echo-section">
          <label>
            Sorted
            <select value={planSortChoice} onChange={(e) => setPlanSortChoice(e.target.value)}>
              <option value="">app default (largest first)</option>
              <option value="label-asc">Group label (A→Z)</option>
              <option value="value-desc">Measure value (largest→smallest)</option>
            </select>
          </label>
          {planGroupCols.length === 2 && planSortChoice && (
            <p className="hint">A two-column grouping doesn't reorder the in-app table yet, but this sort is still saved into the Excel/R output.</p>
          )}
        </div>

        <p className="plan-echo-summary">{planSummaryLine}</p>
        <button type="button" className="btn btn-primary" onClick={runConfirmedPlan}>
          Run
        </button>
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
            title={effectiveTitle}
            highlightLabel={highlightLabel}
            referenceLine={chartType === "bar" ? referenceLine : null}
            pareto={pareto}
            svgRef={svgRef}
            layout={rec.layout}
            footnote={figFootnote.trim() || null}
            grayscale={grayscale}
          />

          {/* P5-3: figure furniture — an editable title and an on-chart
              footnote (both drawn inside the SVG so every export carries
              them), the print-safe palette toggle, and a caption whose text
              is ready to paste as a manuscript figure legend. */}
          <div className="chart-figure-row">
            <label className="chart-text-label">
              Figure title
              <input
                className="chart-text-input"
                value={figTitle}
                placeholder={chartTitle}
                onChange={(e) => setFigTitle(e.target.value)}
              />
            </label>
            <label className="chart-text-label">
              Footnote (shows on the chart)
              <input
                className="chart-text-input"
                value={figFootnote}
                placeholder="e.g. n = 267 encounters, Jan–Jun 2026"
                onChange={(e) => setFigFootnote(e.target.value)}
              />
            </label>
          </div>
          <label className="chart-other-toggle">
            <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />
            Grayscale-safe colors (for black-and-white printing) — one dark-to-light family, so the order survives without color
          </label>
          {figureCaption && (
            <div className="figure-caption-row">
              <p className="dim">{figureCaption}</p>
              <CopyButton text={figureCaption} label="Copy caption" />
            </div>
          )}

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
          {/* P5-1: zero-dependency exports — copy for slides, PNG sized for
              a purpose (P5-2), SVG as the vector that scales to any size.
              Every copy reports its honest outcome in the note below. */}
          {(() => {
            // P5-2: the live legibility read for the chosen size. The svg
            // ref is set after the first paint; until then (or if it's
            // gone) there is nothing to warn about yet.
            const el = svgRef.current;
            const dims = el
              ? { width: Number(el.getAttribute("width")) || 480, height: Number(el.getAttribute("height")) || 300 }
              : null;
            const preset = dims ? computePresetExport(dims, exportPreset, { posterInches }) : null;
            return (
              <>
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
                  <label className="chart-text-label">
                    Download size
                    <select value={exportPreset} onChange={(e) => setExportPreset(e.target.value)}>
                      {EXPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </label>
                  {exportPreset === "poster" && (
                    <label className="chart-text-label">
                      inches wide
                      <input
                        type="number"
                        min="4"
                        max="48"
                        value={posterInches}
                        onChange={(e) => setPosterInches(Number(e.target.value) || 8)}
                        style={{ width: "4.5rem" }}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const svgEl = svgRef.current;
                      if (!svgEl) return;
                      const d = { width: Number(svgEl.getAttribute("width")) || 480, height: Number(svgEl.getAttribute("height")) || 300 };
                      const { scale } = computePresetExport(d, exportPreset, { posterInches });
                      downloadChartPng(svgEl, `${chartFileBase(effectiveTitle)}-${exportPreset}.png`, scale);
                    }}
                  >
                    Download chart as image (PNG)
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => downloadChartSvg(svgRef.current, `${chartFileBase(effectiveTitle)}.svg`)}
                  >
                    Download SVG (scales to any size)
                  </button>
                </div>
                {preset?.warning && <p className="hint" role="status">{preset.warning}</p>}
                <details className="dim">
                  <summary>What do these sizes mean?</summary>
                  <p className="dim">
                    Slide fills a widescreen PowerPoint slide. Poster and the journal figures export at print
                    quality (300 dots per inch): a poster at the width you choose, a single-column journal figure
                    at 3.5 inches wide, double column at 7 inches. The SVG download is a vector file — it has no
                    fixed size and stays sharp at any width.
                  </p>
                </details>
              </>
            );
          })()}
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
function chartFileBase(title) {
  return title.replace(/[^\w -]/g, "").trim() || "chart";
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
