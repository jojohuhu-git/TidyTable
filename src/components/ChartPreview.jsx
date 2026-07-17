// In-app chart preview drawn as plain SVG (build prompt §11). No chart library,
// no icons; colours come from the design tokens (one teal accent, neutral grey).
// The report-card idiom is the default for comparisons: when a highlightLabel is
// given, that bar/point is the accent colour and every peer is grey.

import { foldKey } from "../logic/checkup/normalizers.js";
import { maxOf, countLabel, describeExtreme, describeParetoSummary, PARETO_THRESHOLD } from "../logic/charts/aggregate.js";
import { chartPalette } from "../logic/charts/palette.js";
import { buildChartAriaSummary, buildCrosstabAriaSummary, buildHistogramAriaSummary, buildBoxDotAriaSummary } from "../logic/charts/chartAriaSummary.js";

export const CHART_W = 480;
export const CHART_H = 300;
const W = CHART_W;
const H = CHART_H;
const TITLE_PAD = 24; // B9: room for the real chart title, so it doesn't overlap the plot
const SUBTITLE_PAD = 16; // P3-3: extra room for the automatic largest-category callout
// W4: a long horizontal all-rows bar list grows as tall as it needs — this is
// the per-row height once the list is longer than a normal chart can hold, so
// every category still gets a readable, labeled bar (owner's decision: never
// refuse for "too many values").
const LONG_ROW_H = 22;
// P3-3: past this many categories, per-bar value labels turn into unreadable
// clutter — the numbers are still available via the aria summary and the
// Excel helper table (which already caps its inline row list at 12, too).
const VALUE_LABEL_CAP = 12;

// B9: a real title (e.g. "count by Diagnosis") makes an exported PNG
// self-explanatory on its own, and also says what the bar values are —
// dataset.valueName is already "count" or "total X". P3-3: an optional
// second line names the automatic largest-category callout.
function ChartTitle({ title, subtitle }) {
  if (!title) return null;
  return (
    <>
      <text x={W / 2} y={16} textAnchor="middle" className="chart-title">{title}</text>
      {subtitle && (
        <text x={W / 2} y={30} textAnchor="middle" className="chart-subtitle">{subtitle}</text>
      )}
    </>
  );
}

export default function ChartPreview({ chartType, dataset, highlightLabel, referenceLine, pareto, title, svgRef, layout }) {
  if (!dataset) return null;
  // P6-1: a crosstab (two categorical columns) draws grouped/stacked/100%
  // stacked bars — a different enough shape (a category x subgroup grid, no
  // single "points" array) that it gets its own branch rather than being
  // squeezed through the single-axis BarChart below. Highlighting a single
  // bar and a reference line are P6-4 (cohort-scoped) territory, not this one.
  if (dataset.kind === "crosstab") {
    if (!dataset.categories?.length) return null;
    return <CrosstabBarChart dataset={dataset} title={title} layout={layout} svgRef={svgRef} />;
  }
  // P6-2: a histogram (one numeric column, no grouping) and a box+dot plot
  // (a numeric column's spread within each group) are both `kind:
  // "distribution"` — neither has a `points` array either, same reason the
  // crosstab gets its own branch above.
  if (dataset.kind === "distribution") {
    if (dataset.shape === "histogram") {
      if (!dataset.bins?.length) return null;
      return <HistogramChart dataset={dataset} title={title} svgRef={svgRef} />;
    }
    if (!dataset.groups?.length) return null;
    return <BoxDotChart dataset={dataset} title={title} svgRef={svgRef} />;
  }
  if (!dataset.points?.length) return null;
  const isSubject = (label) =>
    highlightLabel != null && foldKey(label) === foldKey(highlightLabel);
  // W4: with no highlight, color the bars/slices from the chart palette
  // (Okabe-Ito for a short list, a single-hue teal ramp for a long one) — a
  // report-card highlight still overrides everything to the accent/grey pair.
  const palette = chartPalette(dataset.points.length);
  const fill = (label, i) => {
    if (highlightLabel != null) return isSubject(label) ? "var(--accent)" : "var(--line)";
    return palette[i] || "var(--accent)";
  };
  // P3-3: "already computed, just say it" — points are sorted largest-first,
  // so this is display only. Declines (null) for a time-series axis, a tie
  // for first place, or too few categories to compare.
  const subtitle = describeExtreme(dataset);

  if (chartType === "bar") return <BarChart dataset={dataset} fill={fill} title={title} subtitle={subtitle} referenceLine={referenceLine} pareto={pareto} highlightLabel={highlightLabel} svgRef={svgRef} layout={layout} highlighting={highlightLabel != null} />;
  if (chartType === "line") return <LineChart dataset={dataset} title={title} svgRef={svgRef} />;
  if (chartType === "pie") return <PieChart dataset={dataset} fill={fill} title={title} subtitle={subtitle} highlightLabel={highlightLabel} svgRef={svgRef} highlighting={highlightLabel != null} />;
  if (chartType === "scatter") return <ScatterChart dataset={dataset} title={title} svgRef={svgRef} />;
  return null;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

// P2-15: a negative value has no natural "start at zero, grow right" bar —
// draw it growing left from a zero axis instead of clamping/misreading it.
// W4: past what a fixed-height chart can hold, the SVG grows taller (one row
// per category at LONG_ROW_H) so every category is drawn and labeled, largest
// first — the horizontal all-rows layout the advisor recommends for many
// categories. The bars are already horizontal in this component; `layout` and
// the long-list path only change the height and the color ramp.
// P6-3: the "add cumulative % line" panel is a separate strip to the right
// of the bars, not a second scale overlaid on the bars themselves — one axis
// per plot area (dataviz non-negotiable: never a dual-axis chart), reading
// as a small-multiples twin rather than an arbitrary two-scale overlay. Each
// row gets a dot at its own cumulative %, connected row-to-row by a line,
// against a 0–100% scale with a dashed line at the standard 80% threshold.
const PARETO_STRIP_W = 150;
const PARETO_STRIP_PAD = 14;

function BarChart({ dataset, fill, title, subtitle, referenceLine, pareto, highlightLabel, svgRef, layout }) {
  const padL = 130;
  // Phase 8.3: an n (%) value label ("2 (33%)") is wider than a bare number, so
  // the right margin has to leave room or the trailing ")" clips off the SVG.
  const isCountBars = dataset.valueName === "count" && dataset.countTotal != null;
  const padR = isCountBars ? 72 : 40;
  const padY = 16 + (title ? TITLE_PAD : 0) + (subtitle ? SUBTITLE_PAD : 0);
  const points = dataset.points;
  // A "long" list grows the canvas; a short one keeps the classic 300px chart.
  const isLong = points.length > 12 || layout === "horizontal";
  const chartH = isLong ? padY + 16 + points.length * LONG_ROW_H : H;
  const chartW = W + (pareto ? PARETO_STRIP_W : 0);
  const values = points.map((p) => p.value);
  // P3-3: an explicit reference-line value can sit outside the bars' own
  // range (a stated threshold, not just their average) — fold it into the
  // scale so the line is never clipped off the canvas.
  const refValues = referenceLine ? [referenceLine.value] : [];
  const posMax = niceMax(maxOf([...values, ...refValues], 0));
  const negMax = niceMax(maxOf([...values, ...refValues].map((v) => -v), 0));
  const totalRange = posMax + negMax || 1;
  const scale = (W - padL - padR) / totalRange;
  const zeroX = padL + negMax * scale;
  const rowH = (chartH - padY - 16) / points.length;
  const barH = Math.min(rowH * 0.62, 34);
  // Phase 8.3 clinical default: a count bar is labeled n (%) of the cohort;
  // a sum/average total is not a share of a whole, so it stays a bare number.
  const isCount = dataset.valueName === "count";
  const barLabel = (v) => (isCount ? countLabel(v, dataset.countTotal) : String(v));
  // P3-3: past VALUE_LABEL_CAP categories, per-bar labels turn into clutter —
  // hide them (the numbers stay reachable via the aria summary and Excel's
  // helper table).
  const showValueLabels = points.length <= VALUE_LABEL_CAP;
  // B12: a data summary in the aria-label, not just the chart type, so a
  // screen reader user gets the numbers without seeing the SVG. P3-3: the
  // same summary now names a highlight or reference line when either is set.
  const paretoSummary = pareto ? describeParetoSummary(pareto) : null;
  const ariaOpts = { highlightLabel, referenceLine, paretoSummary };
  const ariaLabel = title
    ? `Bar chart of ${title}: ${buildChartAriaSummary(dataset, undefined, ariaOpts)}`
    : `Bar chart: ${buildChartAriaSummary(dataset, undefined, ariaOpts)}`;
  const stripX0 = W + PARETO_STRIP_PAD;
  const stripInnerW = PARETO_STRIP_W - PARETO_STRIP_PAD * 2;
  const paretoX = (pct) => stripX0 + (pct / 100) * stripInnerW;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${chartW} ${chartH}`} width={chartW} height={chartH} className="chart-svg" role="img" aria-label={ariaLabel}>
      <ChartTitle title={title} subtitle={subtitle} />
      {negMax > 0 && <line x1={zeroX} y1={padY} x2={zeroX} y2={chartH - 16} stroke="var(--line)" />}
      {points.map((p, i) => {
        const y = padY + i * rowH + (rowH - barH) / 2;
        const w = Math.max(1, Math.abs(p.value) * scale);
        const negative = p.value < 0;
        const x = negative ? zeroX - w : zeroX;
        return (
          <g key={i}>
            <text x={padL - 8} y={y + barH / 2} textAnchor="end" dominantBaseline="middle" className="chart-label">
              {p.label.length > 18 ? p.label.slice(0, 17) + "…" : p.label}
            </text>
            <rect x={x} y={y} width={w} height={barH} fill={fill(p.label, i)} rx="2" />
            {showValueLabels && (
              <text
                x={negative ? x - 5 : x + w + 5}
                y={y + barH / 2}
                textAnchor={negative ? "end" : "start"}
                dominantBaseline="middle"
                className="chart-value"
              >
                {barLabel(p.value)}
              </text>
            )}
          </g>
        );
      })}
      {referenceLine && (
        <g>
          <line
            className="chart-refline"
            x1={zeroX + referenceLine.value * scale}
            y1={padY}
            x2={zeroX + referenceLine.value * scale}
            y2={chartH - 16}
            stroke="var(--accent)"
            strokeDasharray="4 3"
          />
          <text
            x={zeroX + referenceLine.value * scale}
            y={padY - 4}
            textAnchor="middle"
            className="chart-refline-label"
          >
            {referenceLine.label === "average" ? `avg ${referenceLine.value}` : referenceLine.label}
          </text>
        </g>
      )}
      {pareto && (
        <g>
          <text x={W + PARETO_STRIP_W / 2} y={16} textAnchor="middle" className="chart-label">Cumulative %</text>
          {[0, 50, 100].map((pct) => (
            <text key={pct} x={paretoX(pct)} y={padY - 4} textAnchor="middle" className="chart-label">{pct}%</text>
          ))}
          <line
            x1={paretoX(PARETO_THRESHOLD)} y1={padY} x2={paretoX(PARETO_THRESHOLD)} y2={chartH - 16}
            stroke="var(--line)" strokeDasharray="3 3"
          />
          {pareto.points.map((p, i) => {
            if (i === 0) return null;
            const prev = pareto.points[i - 1];
            const y1 = padY + (i - 1) * rowH + rowH / 2;
            const y2 = padY + i * rowH + rowH / 2;
            return <line key={`pl${i}`} x1={paretoX(prev.cumPct)} y1={y1} x2={paretoX(p.cumPct)} y2={y2} stroke="var(--accent)" strokeWidth="1.5" />;
          })}
          {pareto.points.map((p, i) => (
            <circle key={`pd${i}`} cx={paretoX(p.cumPct)} cy={padY + i * rowH + rowH / 2} r="3" fill="var(--accent)" />
          ))}
        </g>
      )}
    </svg>
  );
}

function LineChart({ dataset, title, svgRef }) {
  const padL = 44;
  const padR = 20;
  const padB = 34;
  const padT = 16 + (title ? TITLE_PAD : 0);
  const points = dataset.points;
  const max = niceMax(maxOf(points.map((p) => p.value)));
  const stepX = (W - padL - padR) / Math.max(1, points.length - 1);
  const scaleY = (H - padT - padB) / max;
  const xy = points.map((p, i) => [padL + i * stepX, H - padB - p.value * scaleY]);
  const d = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="chart-svg" role="img" aria-label={title ? `Line chart of ${title}` : "Line chart"}>
      <ChartTitle title={title} />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--line)" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="var(--line)" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {xy.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="3.5" fill="var(--accent)" />
          <text x={x} y={H - padB + 16} textAnchor="middle" className="chart-label">
            {points[i].label.length > 8 ? points[i].label.slice(0, 7) + "…" : points[i].label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PieChart({ dataset, fill, title, subtitle, highlightLabel, svgRef }) {
  const cx = 150;
  const cy = H / 2 + (title ? TITLE_PAD / 2 : 0);
  const r = 110;
  const total = dataset.points.reduce((s, p) => s + p.value, 0) || 1;
  let angle = -Math.PI / 2;
  const greys = ["var(--accent)", "var(--line)", "#c9d6d3", "#9fb7b2"];
  const ariaOpts = { highlightLabel };
  const ariaLabel = title
    ? `Pie chart of ${title}: ${buildChartAriaSummary(dataset, undefined, ariaOpts)}`
    : `Pie chart: ${buildChartAriaSummary(dataset, undefined, ariaOpts)}`;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="chart-svg" role="img" aria-label={ariaLabel}>
      <ChartTitle title={title} subtitle={subtitle} />
      {dataset.points.map((p, i) => {
        const frac = p.value / total;
        const color = dataset.points.length <= 4 ? greys[i % greys.length] : "var(--accent)";
        // P2-15: a 100% slice is a full circle — the arc's start and end
        // point coincide, so an SVG "A" path draws nothing. Draw a <circle>
        // instead whenever a single slice accounts for (essentially) the
        // whole pie.
        if (frac >= 1 - 1e-9) {
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} fill={fill ? fill(p.label, i) : color} stroke="var(--card)" strokeWidth="1.5" />
              <text x={cx} y={cy + r + 18} textAnchor="middle" dominantBaseline="middle" className="chart-label">
                {p.label} ({Math.round(frac * 100)}%)
              </text>
            </g>
          );
        }
        const end = angle + frac * 2 * Math.PI;
        const large = frac > 0.5 ? 1 : 0;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const mid = (angle + end) / 2;
        const d = `M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
        angle = end;
        return (
          <g key={i}>
            <path d={d} fill={fill ? fill(p.label, i) : color} stroke="var(--card)" strokeWidth="1.5" />
            <text x={cx + (r + 18) * Math.cos(mid)} y={cy + (r + 18) * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle" className="chart-label">
              {p.label} ({Math.round(frac * 100)}%)
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// P6-1: a mandatory legend for the crosstab's subgroup colors — up to 8
// swatches (Okabe-Ito), wrapped 4 to a row since the cap never exceeds 8.
const LEGEND_COLS = 4;
const LEGEND_ROW_H = 18;

function legendHeight(n) {
  return 8 + Math.ceil(n / LEGEND_COLS) * LEGEND_ROW_H;
}

function Legend({ subgroups, palette, x, y, width }) {
  const colW = width / Math.min(LEGEND_COLS, subgroups.length);
  return (
    <g>
      {subgroups.map((name, i) => {
        const col = i % LEGEND_COLS;
        const row = Math.floor(i / LEGEND_COLS);
        const cx = x + col * colW;
        const cy = y + row * LEGEND_ROW_H;
        const label = name.length > 16 ? name.slice(0, 15) + "…" : name;
        return (
          <g key={name}>
            <rect x={cx} y={cy} width="10" height="10" fill={palette[i]} rx="2" />
            <text x={cx + 14} y={cy + 9} className="chart-label" dominantBaseline="middle">{label}</text>
          </g>
        );
      })}
    </g>
  );
}

// P6-1: grouped / stacked / 100%-stacked bars for a two-categorical-column
// crosstab (aggregate.js buildCrosstabDataset). Keeps this app's one house
// style — bars grow rightward from a left-hand category label, same as the
// single-axis BarChart above — rather than switching to vertical columns:
// "matching but distinct" applies to chart orientation too, not just color.
// grouped: one thin sub-bar per subgroup, sharing one scale across the whole
// chart. stacked: one bar per category, subgroup segments end to end, sharing
// one scale (the largest category total). stacked100: same as stacked but
// each bar is individually rescaled to fill the full width — the length axis
// becomes "% of that category" (0/25/50/75/100% ticks along the bottom), and
// each category's true n is appended to its label so the percent scaling
// never hides the real sample size.
const GROUP_SUB_BAR_H = 14;
const GROUP_SUB_GAP = 2;
const STACK_BAR_H = 26;
const CROSSTAB_BLOCK_GAP = 10;

function CrosstabBarChart({ dataset, title, layout, svgRef }) {
  const padL = 130;
  const padR = 44;
  const categories = dataset.categories;
  const subgroups = dataset.subgroups;
  const palette = chartPalette(subgroups.length);
  const legendH = legendHeight(subgroups.length);
  const padTop = 16 + (title ? TITLE_PAD : 0);
  const padY = padTop + legendH;
  const padB = layout === "stacked100" ? 30 : 16;

  const blockH = layout === "grouped"
    ? subgroups.length * GROUP_SUB_BAR_H + (subgroups.length - 1) * GROUP_SUB_GAP
    : STACK_BAR_H;
  const chartH = padY + categories.length * (blockH + CROSSTAB_BLOCK_GAP) + padB;

  const innerW = W - padL - padR;
  const maxCell = layout === "grouped" ? niceMax(maxOf(categories.flatMap((c) => c.values), 0)) : null;
  const maxTotal = layout === "stacked" ? niceMax(maxOf(categories.map((c) => c.total), 0)) : null;

  const ariaLabel = title
    ? `Bar chart of ${title}: ${buildCrosstabAriaSummary(dataset)}`
    : `Bar chart: ${buildCrosstabAriaSummary(dataset)}`;

  let y = padY;
  const blocks = categories.map((c) => {
    const top = y;
    y += blockH + CROSSTAB_BLOCK_GAP;
    return { c, top };
  });

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${chartH}`} width={W} height={chartH} className="chart-svg" role="img" aria-label={ariaLabel}>
      <ChartTitle title={title} />
      <Legend subgroups={subgroups} palette={palette} x={padL} y={padTop + 4} width={innerW} />
      {blocks.map(({ c, top }, ci) => {
        const label = layout === "stacked100" ? `${c.label} (n=${c.total})` : c.label;
        return (
          <g key={ci}>
            <text x={padL - 8} y={top + blockH / 2} textAnchor="end" dominantBaseline="middle" className="chart-label">
              {label.length > 22 ? label.slice(0, 21) + "…" : label}
            </text>
            {layout === "grouped" && c.values.map((v, si) => {
              if (!v) return null;
              const rowY = top + si * (GROUP_SUB_BAR_H + GROUP_SUB_GAP);
              const w = Math.max(1, (v / maxCell) * innerW);
              return <rect key={si} x={padL} y={rowY} width={w} height={GROUP_SUB_BAR_H} fill={palette[si]} rx="2" />;
            })}
            {layout !== "grouped" && (() => {
              const scale = layout === "stacked100" ? innerW / (c.total || 1) : innerW / (maxTotal || 1);
              let x = padL;
              return c.values.map((v, si) => {
                if (!v) return null;
                const w = v * scale;
                const rect = <rect key={si} x={x} y={top} width={w} height={blockH} fill={palette[si]} />;
                x += w;
                return rect;
              });
            })()}
          </g>
        );
      })}
      {layout === "stacked100" && [0, 25, 50, 75, 100].map((p) => (
        <text key={p} x={padL + innerW * (p / 100)} y={chartH - 6} textAnchor="middle" className="chart-label">{p}%</text>
      ))}
    </svg>
  );
}

// P6-2: a histogram of one numeric column — vertical columns, unlike every
// other bar in this app. Bins are a continuous number line, not named
// categories, so reading left-to-right as "increasing value" is the
// near-universal convention for a distribution — matches this app's other
// two-axis chart (ScatterChart) rather than the "labels down the left" house
// style the categorical bars use. Both axes carry a title AND numeric ticks
// (bin ranges along the bottom, evenly spaced counts up the side): the
// app's LineChart has neither yet, and a histogram should not repeat that gap.
function HistogramChart({ dataset, title, svgRef }) {
  const bins = dataset.bins;
  const padL = 46;
  const padR = 16;
  const padB = 52;
  const padT = 16 + (title ? TITLE_PAD : 0) + (dataset.binRule ? SUBTITLE_PAD : 0);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxCount = niceMax(maxOf(bins.map((b) => b.count), 0));
  const barGap = bins.length > 15 ? 1 : 2;
  const barW = innerW / bins.length;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxCount * f));
  const ariaLabel = title
    ? `Histogram of ${title}: ${buildHistogramAriaSummary(dataset)}`
    : `Histogram: ${buildHistogramAriaSummary(dataset)}`;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="chart-svg" role="img" aria-label={ariaLabel}>
      <ChartTitle title={title} subtitle={dataset.binRule} />
      <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="var(--line)" />
      <line x1={padL} y1={padT + innerH} x2={W - padR} y2={padT + innerH} stroke="var(--line)" />
      {yTicks.map((t, i) => {
        const y = padT + innerH - (maxCount ? (t / maxCount) * innerH : 0);
        return (
          <g key={i}>
            <line x1={padL - 4} y1={y} x2={padL} y2={y} stroke="var(--line)" />
            <text x={padL - 8} y={y} textAnchor="end" dominantBaseline="middle" className="chart-label">{t}</text>
          </g>
        );
      })}
      {bins.map((b, i) => {
        const h = maxCount ? (b.count / maxCount) * innerH : 0;
        const x = padL + i * barW + barGap / 2;
        const w = Math.max(1, barW - barGap);
        const y = padT + innerH - h;
        const showLabel = bins.length <= 20;
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} fill="var(--accent)" rx="2" />
            {showLabel && (
              <text x={x + w / 2} y={padT + innerH + 14} textAnchor="middle" className="chart-label">
                {b.label.length > 9 ? b.label.slice(0, 8) + "…" : b.label}
              </text>
            )}
          </g>
        );
      })}
      <text x={padL + innerW / 2} y={H - 6} textAnchor="middle" className="chart-label">{dataset.valueName}</text>
      <text x={12} y={padT + innerH / 2} textAnchor="middle" className="chart-label" transform={`rotate(-90 12 ${padT + innerH / 2})`}>Number of rows</text>
    </svg>
  );
}

// P6-2: box + jittered-dot plot — the spread of a numeric column within each
// group. Kept the app's horizontal "labels down the left" house style (like
// BarChart and CrosstabBarChart above) rather than the histogram's vertical
// style: unlike a histogram's numeric bins, a box+dot's rows are named
// categories (diagnoses, wards) that can run long, and reading them down the
// left edge is exactly the horizontal bar chart's own reasoning.
const BOXDOT_ROW_H = 34;
const BOXDOT_BOX_H = 16;

// Deterministic (not Math.random): the same dataset always draws the same
// dots, so a re-render or a downloaded PNG never looks different from what
// was on screen a moment ago.
function jitterOffset(i, n, maxSpread) {
  if (n <= 1) return 0;
  const frac = ((i * 2654435761) % 1000) / 1000;
  return (frac - 0.5) * 2 * maxSpread;
}

function BoxDotChart({ dataset, title, svgRef }) {
  const padL = 130;
  const padR = 30;
  const padB = 40;
  const groups = dataset.groups;
  const padT = 16 + (title ? TITLE_PAD : 0);
  const chartH = padT + groups.length * BOXDOT_ROW_H + padB;
  const allValues = groups.flatMap((g) => [g.stats.min, g.stats.max]);
  // niceMax(0) returns 1 (a bare-zero axis ceiling would be a degenerate
  // chart) — harmless for BarChart above, which only conditionally draws a
  // zero LINE from it, but this chart also prints the axis as NUMBER ticks,
  // which would show a dishonest "-1" tick for data that has no negative
  // values at all. Only reserve negative axis space when a value actually is
  // negative.
  const hasNegative = allValues.some((v) => v < 0);
  const posMax = niceMax(maxOf(allValues, 0));
  const negMax = hasNegative ? niceMax(maxOf(allValues.map((v) => -v), 0)) : 0;
  const innerW = W - padL - padR;
  const scale = innerW / ((posMax + negMax) || 1);
  const zeroX = padL + negMax * scale;
  const xAt = (v) => zeroX + v * scale;
  const palette = chartPalette(groups.length);
  const ariaLabel = title
    ? `Box and dot plot of ${title}: ${buildBoxDotAriaSummary(dataset)}`
    : `Box and dot plot: ${buildBoxDotAriaSummary(dataset)}`;

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${chartH}`} width={W} height={chartH} className="chart-svg" role="img" aria-label={ariaLabel}>
      <ChartTitle title={title} />
      {negMax > 0 && <line x1={zeroX} y1={padT} x2={zeroX} y2={chartH - padB} stroke="var(--line)" />}
      {groups.map((g, gi) => {
        const cy = padT + gi * BOXDOT_ROW_H + BOXDOT_ROW_H / 2;
        const boxTop = cy - BOXDOT_BOX_H / 2;
        const color = palette[gi] || "var(--accent)";
        const dotSpread = Math.min(BOXDOT_ROW_H * 0.3, 9);
        return (
          <g key={gi}>
            <text x={padL - 8} y={cy} textAnchor="end" dominantBaseline="middle" className="chart-label">
              {g.label.length > 18 ? g.label.slice(0, 17) + "…" : g.label}
            </text>
            <line x1={xAt(g.stats.min)} y1={cy} x2={xAt(g.stats.max)} y2={cy} stroke="var(--line)" />
            <line x1={xAt(g.stats.min)} y1={cy - 5} x2={xAt(g.stats.min)} y2={cy + 5} stroke="var(--line)" />
            <line x1={xAt(g.stats.max)} y1={cy - 5} x2={xAt(g.stats.max)} y2={cy + 5} stroke="var(--line)" />
            <rect
              x={Math.min(xAt(g.stats.q1), xAt(g.stats.q3))}
              y={boxTop}
              width={Math.max(1, Math.abs(xAt(g.stats.q3) - xAt(g.stats.q1)))}
              height={BOXDOT_BOX_H}
              fill={color}
              opacity="0.35"
              stroke={color}
            />
            <line x1={xAt(g.stats.median)} y1={boxTop} x2={xAt(g.stats.median)} y2={boxTop + BOXDOT_BOX_H} stroke={color} strokeWidth="2" />
            <text x={xAt(g.stats.median)} y={boxTop - 4} textAnchor="middle" className="chart-value">{g.stats.median}</text>
            {g.values
              ? g.values.map((v, vi) => (
                <circle key={vi} cx={xAt(v)} cy={cy + jitterOffset(vi, g.values.length, dotSpread)} r="2.5" fill={color} opacity="0.7" />
              ))
              : (
                <text x={xAt(g.stats.max) + 8} y={cy} dominantBaseline="middle" className="chart-label">
                  n={g.n}, box only
                </text>
              )}
          </g>
        );
      })}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = -negMax + f * (posMax + negMax);
        return (
          <text key={f} x={xAt(v)} y={chartH - padB + 14} textAnchor="middle" className="chart-label">
            {Math.round(v * 100) / 100}
          </text>
        );
      })}
      <text x={padL + innerW / 2} y={chartH - 6} textAnchor="middle" className="chart-label">{dataset.valueName}</text>
    </svg>
  );
}

function ScatterChart({ dataset, title, svgRef }) {
  const padL = 44;
  const padR = 20;
  const padB = 34;
  const padT = 16 + (title ? TITLE_PAD : 0);
  const xs = dataset.points.map((p) => p.x);
  const ys = dataset.points.map((p) => p.y);
  const maxX = niceMax(maxOf(xs));
  const maxY = niceMax(maxOf(ys));
  const sx = (W - padL - padR) / maxX;
  const sy = (H - padT - padB) / maxY;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="chart-svg" role="img" aria-label={title ? `Scatter plot of ${title}` : "Scatter plot"}>
      <ChartTitle title={title} />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--line)" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="var(--line)" />
      {dataset.points.map((p, i) => (
        <circle key={i} cx={padL + p.x * sx} cy={H - padB - p.y * sy} r="4" fill="var(--accent)" opacity="0.75" />
      ))}
      <text x={(W) / 2} y={H - 6} textAnchor="middle" className="chart-label">{dataset.xName}</text>
      <text x={12} y={H / 2} textAnchor="middle" className="chart-label" transform={`rotate(-90 12 ${H / 2})`}>{dataset.yName}</text>
    </svg>
  );
}
