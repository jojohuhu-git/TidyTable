// In-app chart preview drawn as plain SVG (build prompt §11). No chart library,
// no icons; colours come from the design tokens (one teal accent, neutral grey).
// The report-card idiom is the default for comparisons: when a highlightLabel is
// given, that bar/point is the accent colour and every peer is grey.

import { foldKey } from "../logic/checkup/normalizers.js";
import { maxOf, countLabel, describeExtreme } from "../logic/charts/aggregate.js";
import { chartPalette } from "../logic/charts/palette.js";
import { buildChartAriaSummary } from "../logic/charts/chartAriaSummary.js";

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

export default function ChartPreview({ chartType, dataset, highlightLabel, referenceLine, title, svgRef, layout }) {
  if (!dataset || !dataset.points?.length) return null;
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

  if (chartType === "bar") return <BarChart dataset={dataset} fill={fill} title={title} subtitle={subtitle} referenceLine={referenceLine} highlightLabel={highlightLabel} svgRef={svgRef} layout={layout} highlighting={highlightLabel != null} />;
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
function BarChart({ dataset, fill, title, subtitle, referenceLine, highlightLabel, svgRef, layout }) {
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
  const ariaOpts = { highlightLabel, referenceLine };
  const ariaLabel = title
    ? `Bar chart of ${title}: ${buildChartAriaSummary(dataset, undefined, ariaOpts)}`
    : `Bar chart: ${buildChartAriaSummary(dataset, undefined, ariaOpts)}`;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${chartH}`} width={W} height={chartH} className="chart-svg" role="img" aria-label={ariaLabel}>
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
