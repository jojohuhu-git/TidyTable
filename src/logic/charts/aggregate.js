// Turn two chosen columns into the dataset the chart advisor and preview use
// (build prompt §11). Two number columns stay as raw points for a scatter;
// otherwise the label column is grouped and each group gets a count, or the total
// of a numeric value column. Month/date labels are flagged so the advisor can
// prefer a line.

import { foldKey } from "../checkup/normalizers.js";
import { toNumber, topNWithTies, computeNumericStats } from "../offline/cohort.js";

const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const MONTH_INDEX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// P2-14: turn a time-like label ("2024-03", "Mar 2024", "Q1 2024") into a
// number that sorts chronologically. Returns null when the label doesn't
// parse, so the caller can fall back to insertion order rather than guess.
function timeSortKey(label) {
  const s = String(label).trim();
  const iso = s.match(/^(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/);
  if (iso) {
    const mo = iso[2] ? Number(iso[2]) : 1;
    if (mo >= 1 && mo <= 12) {
      const d = iso[3] ? Number(iso[3]) : 1;
      return Number(iso[1]) * 10000 + mo * 100 + d;
    }
  }
  const q = s.match(/q([1-4])\D*(\d{4})/i) || s.match(/(\d{4})\D*q([1-4])/i);
  if (q) {
    const [, a, b] = q;
    const [y, quarter] = /^\d{4}$/.test(a) ? [a, b] : [b, a];
    return Number(y) * 10000 + (Number(quarter) - 1) * 300 + 1;
  }
  const mon = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\D*(\d{4})?/i);
  if (mon) {
    const y = mon[2] ? Number(mon[2]) : 0;
    return y * 10000 + MONTH_INDEX[mon[1].toLowerCase()] * 100 + 1;
  }
  return null;
}

// Phase 8.3: format a COUNT bar's clinical label — "12 (34%)" — as a share of
// the cohort denominator captured at grouping time (dataset.countTotal). Whole
// percent, the n (%) convention clinicians paste into tables. Falls back to the
// bare number when there is no denominator (a sum/average total, or an empty
// cohort), so a non-share value is never dressed up as a percentage.
export function countLabel(value, countTotal) {
  if (countTotal == null || countTotal <= 0) return String(value);
  return `${value} (${Math.round((value / countTotal) * 100)}%)`;
}

// P1-6: a spread of a 200k+-element array (Math.max(...arr)) blows the call
// stack (RangeError). A plain reduce loop has no such limit.
export function maxOf(values, fallback = 0) {
  let m = fallback;
  for (const v of values) if (v > m) m = v;
  return m;
}

// P1-6: a scatter with hundreds of thousands of rows is unreadable and slow
// to render as one SVG circle per row. Sample down to a fixed cap, evenly
// spaced through the data (not just the first N, which could all be one
// cluster if the sheet happens to be sorted) so the shape stays honest.
const SCATTER_POINT_CAP = 2000;
function samplePoints(points, cap) {
  if (points.length <= cap) return points;
  const step = points.length / cap;
  const sampled = [];
  for (let i = 0; i < cap; i++) sampled.push(points[Math.floor(i * step)]);
  return sampled;
}

function isNumericColumn(sheet, col) {
  const h = sheet.headers.find((x) => x.name === col);
  if (h && (h.type === "number" || h.type === "mixed (text + numbers)")) return true;
  const vals = sheet.rows.map((r) => r[col]).filter((v) => v != null);
  return vals.length > 0 && vals.every((v) => typeof v === "number" || (String(v).trim() !== "" && !isNaN(Number(v))));
}

// P4-2: fold a raw date-like value down to its month ("2024-01") or quarter
// ("2024-Q1") for a trend chart, so the request groups by calendar period
// instead of drawing one point per exact date. Returns null for a value that
// isn't shaped like a date — the caller skips it rather than guessing a
// bucket for unreadable text (e.g. a date the Step 2 fix declined to rewrite).
function bucketDateLabel(raw, granularity) {
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const [, y, mo] = m;
  if (granularity === "quarter") return `${y}-Q${Math.ceil(Number(mo) / 3)}`;
  return `${y}-${mo}`;
}

function labelsLookLikeTime(sheet, col) {
  const h = sheet.headers.find((x) => x.name === col);
  if (h && h.type === "date") return true;
  const vals = sheet.rows.map((r) => r[col]).filter((v) => v != null).slice(0, 50);
  if (vals.length === 0) return false;
  return vals.every((v) => {
    const s = String(v).trim();
    return /^\d{4}([-/]\d{1,2})?/.test(s) || MONTHS.test(s) || /^q[1-4]/i.test(s);
  });
}

// Honesty fix (2026-07-10): this used to strip every non-digit character and
// hand the leftover to Number(), which silently turned pure text with no
// digits at all ("N/A", "pending") into "" -> 0 — a real value, not "no data".
// Reuse the offline engine's toNumber (already null-safe for exactly this
// case) so a genuinely unreadable cell is excluded here the same honest way
// it is everywhere else numbers get parsed.
const num = (v) => {
  const n = toNumber(v);
  return n == null ? NaN : n;
};

// W4: apply an optional single-column equality filter before grouping — the
// scoped-down "escherichia coli by ward" reading of a free-text chart request
// (see textToChart.js). foldKey-matched, same as everywhere else values are
// compared loosely by spelling/case/spacing.
function applyFilter(rows, filter) {
  if (!filter) return rows;
  const want = foldKey(filter.value);
  return rows.filter((r) => r[filter.column] != null && foldKey(r[filter.column]) === want);
}

// sheet: { headers, rows }. valueCol may be null → count per label.
// options.aggMode: "sum" (default when valueCol is given) | "average" | "count".
// options.filter: { column, value } — an optional equality filter applied to
// the rows before grouping (W4), never silently: the resolved dataset's
// `filter` field is always handed back so the UI/Excel steps can show it.
export function buildDataset(sheet, labelCol, valueCol, options = {}) {
  const { filter = null, bucket = null } = options;
  const rows = applyFilter(sheet.rows, filter);
  const labelNum = isNumericColumn(sheet, labelCol);
  const valueNum = valueCol ? isNumericColumn(sheet, valueCol) : false;
  const aggMode = options.aggMode || (valueCol && valueNum ? "sum" : "count");

  // Two number columns → scatter of raw points (a filter/aggMode makes no
  // sense here — an x/y scatter is always the raw points).
  if (valueCol && labelNum && valueNum) {
    const raw = [];
    for (const r of rows) {
      const x = num(r[labelCol]);
      const y = num(r[valueCol]);
      if (Number.isFinite(x) && Number.isFinite(y)) raw.push({ x, y });
    }
    const points = samplePoints(raw, SCATTER_POINT_CAP);
    return {
      kind: "xy", points, xName: labelCol, yName: valueCol,
      totalPoints: raw.length, sampled: points.length < raw.length, filter,
    };
  }

  // Otherwise group by the label column.
  const groups = new Map(); // foldKey -> { label, value, n }
  const unbucketable = []; // P4-2: raw values a requested bucket couldn't parse as a date
  for (const r of rows) {
    let raw = r[labelCol];
    if (raw == null || String(raw).trim() === "") continue;
    if (bucket) {
      const bucketed = bucketDateLabel(raw, bucket);
      if (bucketed == null) {
        if (!unbucketable.includes(String(raw))) unbucketable.push(String(raw));
        continue;
      }
      raw = bucketed;
    }
    const k = foldKey(raw);
    if (!groups.has(k)) groups.set(k, { label: String(raw), value: 0, n: 0 });
    const g = groups.get(k);
    if (valueCol && valueNum && aggMode !== "count") {
      const v = num(r[valueCol]);
      if (Number.isFinite(v)) { g.value += v; g.n += 1; }
    } else {
      g.value += 1;
    }
  }
  // Honesty fix (2026-07-10, Phase 2 warm-up): a group whose values were ALL
  // unreadable (e.g. every cell "N/A") used to average to 0 — indistinguishable
  // from a real zero. Drop that group from the plotted points instead (never
  // silently draw 0) and name it in `noDataGroups` so the panel can say plainly
  // it has no readable numbers, not hide the gap.
  const noDataGroups = [];
  // `n` (how many readable numbers went into each group) is internal to the
  // average calculation below — stripped from every point before it leaves
  // this function, so a plain count/sum dataset's points stay exactly
  // { label, value } as every existing caller (and test) expects.
  let points = [...groups.values()]
    .filter(({ label, n }) => {
      if (aggMode === "average" && n === 0) { noDataGroups.push(label); return false; }
      return true;
    })
    .map(({ label, value, n }) => (
      aggMode === "average"
        // W4: an average is not a running total — divide by how many readable
        // numbers actually went into it, not by every row in the group (a
        // blank/non-numeric cell is skipped, not counted as a zero).
        ? { label, value: n ? Math.round((value / n) * 100) / 100 : 0 }
        : { label, value }
    ));
  const labelIsTime = labelsLookLikeTime(sheet, labelCol);
  if (labelIsTime) {
    const keys = points.map((p) => timeSortKey(p.label));
    if (keys.every((k) => k != null)) {
      points = points
        .map((p, i) => ({ p, k: keys[i] }))
        .sort((a, b) => a.k - b.k)
        .map(({ p }) => p);
    }
  } else {
    // B9: the bar Excel step already suggests sorting largest-to-smallest —
    // the in-app preview should model the same thing instead of leaving
    // categories in first-appearance order.
    points = [...points].sort((a, b) => b.value - a.value);
  }
  const isCount = !(aggMode === "average" || (aggMode === "sum" && valueCol && valueNum));
  const valueName = aggMode === "average" ? `average ${valueCol}`
    : aggMode === "sum" && valueCol && valueNum ? `total ${valueCol}`
      : "count";
  // Phase 8.3: the cohort denominator behind a COUNT chart, captured on the
  // FULL grouping (before any top-N cap or "Other" fold) so an n (%) label is a
  // share of the whole cohort, not just the bars still on screen. Only a count
  // is a share of a whole — a sum/average total is not, so it carries no %.
  const countTotal = isCount ? points.reduce((s, p) => s + p.value, 0) : null;
  return {
    kind: "categorical",
    points,
    labelIsTime,
    valueName,
    labelName: labelCol,
    filter,
    ...(isCount ? { countTotal } : {}),
    ...(noDataGroups.length ? { noDataGroups } : {}),
    ...(bucket ? { bucket } : {}),
    ...(unbucketable.length ? { unbucketableValues: unbucketable } : {}),
  };
}

// P3-3: the automatic "Most common: X (n%)" / "Highest average: X (v)"
// subtitle. Points are already sorted largest-first (above), so this is
// display only, never a second aggregation. Declines (returns null) rather
// than guessing whenever the claim wouldn't be honest: fewer than two
// categories to compare, a tie for first place, a time-series axis (a "most
// common month" isn't the comparison being asked for), or a dataset shape
// too thin to know what kind of value it's describing.
export function describeExtreme(dataset) {
  if (!dataset || dataset.kind !== "categorical" || dataset.labelIsTime) return null;
  const [top, second] = dataset.points || [];
  if (!top || !second || top.value === second.value) return null;
  if (dataset.valueName === "count") {
    if (dataset.countTotal == null) return null;
    const pct = Math.round((top.value / dataset.countTotal) * 100);
    return `Most common: ${top.label} (${pct}%)`;
  }
  if (typeof dataset.valueName !== "string") return null;
  const verb = dataset.valueName.startsWith("average") ? "Highest average" : "Highest total";
  return `${verb}: ${top.label} (${top.value})`;
}

// W4: fold every category below `thresholdPct` of the dataset's total into a
// single "Other" bucket — offered, never forced, and always reversible (the
// caller just re-builds the dataset without this applied). Time-series
// datasets are left alone (grouping months into "Other" would be dishonest
// about when things happened); anything already at or under the pie-eligible
// slice count is a no-op, since there is nothing worth collapsing.
export function groupSmallIntoOther(dataset, thresholdPct = 2) {
  if (!dataset || dataset.kind !== "categorical" || dataset.labelIsTime) return dataset;
  const total = dataset.points.reduce((s, p) => s + Math.abs(p.value), 0) || 1;
  const kept = [];
  let otherValue = 0;
  let otherCount = 0;
  for (const p of dataset.points) {
    if ((Math.abs(p.value) / total) * 100 < thresholdPct) {
      otherValue += p.value;
      otherCount += 1;
    } else {
      kept.push(p);
    }
  }
  if (otherCount < 2) return dataset; // nothing meaningful to collapse
  const points = [...kept, { label: `Other (${otherCount} smaller groups)`, value: otherValue }];
  return { ...dataset, points, otherGrouped: otherCount };
}

// P6-1: two-categorical-column crosstab (label x subgroup -> counts) for
// grouped/stacked/100%-stacked bars — "drug mix by diagnosis", "drug use
// compared between diagnoses". Counts only (no sum/average — the ask is
// always "how many of each subgroup within each category"). Categories
// (outer axis) are never capped or folded (that is P6-5's small-multiples
// territory); subgroups (the color-coded inner axis) ARE capped at the
// Okabe-Ito 8-color palette — beyond that, the smallest subgroups fold into
// one "Other" bucket per category, named the same way groupSmallIntoOther
// already names a folded "Other" bar, so a legend never needs a 9th color.
const CROSSTAB_SUBGROUP_CAP = 8;

export function buildCrosstabDataset(sheet, labelCol, subgroupCol, options = {}) {
  const { filter = null } = options;
  const rows = applyFilter(sheet.rows, filter);

  const labelTotals = new Map(); // foldKey -> { label, total }
  const subgroupTotals = new Map(); // foldKey -> { label, total }
  const cells = new Map(); // labelKey -> Map(subgroupKey -> count)

  for (const r of rows) {
    const lRaw = r[labelCol];
    const sRaw = r[subgroupCol];
    if (lRaw == null || String(lRaw).trim() === "") continue;
    if (sRaw == null || String(sRaw).trim() === "") continue;
    const lKey = foldKey(lRaw);
    const sKey = foldKey(sRaw);
    if (!labelTotals.has(lKey)) labelTotals.set(lKey, { label: String(lRaw), total: 0 });
    labelTotals.get(lKey).total += 1;
    if (!subgroupTotals.has(sKey)) subgroupTotals.set(sKey, { label: String(sRaw), total: 0 });
    subgroupTotals.get(sKey).total += 1;
    if (!cells.has(lKey)) cells.set(lKey, new Map());
    const m = cells.get(lKey);
    m.set(sKey, (m.get(sKey) || 0) + 1);
  }

  const labelOrder = [...labelTotals.entries()].sort((a, b) => b[1].total - a[1].total);
  let subgroupOrder = [...subgroupTotals.entries()].sort((a, b) => b[1].total - a[1].total);

  let otherGrouped = 0;
  let otherKeys = new Set();
  if (subgroupOrder.length > CROSSTAB_SUBGROUP_CAP) {
    const folded = subgroupOrder.slice(CROSSTAB_SUBGROUP_CAP - 1);
    otherGrouped = folded.length;
    otherKeys = new Set(folded.map(([k]) => k));
    subgroupOrder = subgroupOrder.slice(0, CROSSTAB_SUBGROUP_CAP - 1);
  }
  const subgroups = subgroupOrder.map(([, v]) => v.label);
  if (otherGrouped > 0) subgroups.push(`Other (${otherGrouped} smaller groups)`);
  const subgroupIndex = new Map(subgroupOrder.map(([k], i) => [k, i]));
  const otherIndex = otherGrouped > 0 ? subgroups.length - 1 : -1;

  const categories = labelOrder.map(([lKey, lv]) => {
    const values = new Array(subgroups.length).fill(0);
    const rowCells = cells.get(lKey);
    if (rowCells) {
      for (const [sKey, count] of rowCells) {
        const idx = otherKeys.has(sKey) ? otherIndex : subgroupIndex.get(sKey);
        if (idx != null) values[idx] += count;
      }
    }
    return { label: lv.label, total: values.reduce((s, v) => s + v, 0), values };
  });

  return {
    kind: "crosstab",
    labelName: labelCol,
    subgroupName: subgroupCol,
    categories,
    subgroups,
    filter,
    ...(otherGrouped > 0 ? { otherGrouped } : {}),
  };
}

// Phase 4 (2026-07-10): the Step 9 mirror of the Q&A "most common"/"top N"
// ranking family (see offline/matcher.js's detectTopN) — "top 5 drugs" caps
// the bar chart at 5, sorted by count, largest first; "least common" reorders
// ascending. Reuses the exact same tie-at-the-cutoff rule Step 3 uses
// (topNWithTies) so a tied Nth bar is never arbitrarily half-shown, and
// `rankRequestedN`/`rankShown` let the panel say so honestly when a tie made
// the shown count differ from what was asked for. Time-series datasets are
// left alone — capping "top 5 months" isn't a meaningful chart-time concept
// (Phase 8 territory).
export function applyRankCap(dataset, rank) {
  if (!dataset || dataset.kind !== "categorical" || dataset.labelIsTime || !rank) return dataset;
  const { n, direction } = rank;
  if (n == null) {
    const points = [...dataset.points].sort((a, b) => (direction === "least" ? a.value - b.value : b.value - a.value));
    return { ...dataset, points };
  }
  const points = topNWithTies(dataset.points, n, (p) => p.value, direction);
  return { ...dataset, points, rankRequestedN: n, rankShown: points.length };
}

// P1-6 (same reasoning as maxOf above): a plain Math.min(...arr)/Math.max(...arr)
// blows the call stack on a large array. One safe pass for both.
function minMaxOf(values) {
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

// P6-2: round a bin edge to a readable number for a caption/axis label —
// whole numbers stay bare, anything else keeps at most 2 decimal places
// (matching computeNumericStats' rounding elsewhere in the app).
function fmtBinEdge(v) {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

// P6-2: pick a "nice" bin width (1, 2, 5, or 10 times a power of ten) so bin
// edges are round numbers a reader can act on, not "4.5–6.5". Aims for
// roughly `targetBins` bars across the data's range.
function niceBinWidth(range, targetBins) {
  const raw = range / targetBins;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / mag;
  const niceResidual = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
  return niceResidual * mag;
}

// P6-2: integer-friendly binning — the spec's own example is a duration
// histogram that must show 5, 7, 10 days as their OWN bars, never a
// "4.5–6.5" range that no real value could ever equal. When every value is a
// whole number and the range is small enough to draw one bar per integer
// without the chart turning into a wall of bars, bin width is exactly 1 and
// each bar's label is the bare integer. Otherwise, a "nice" wider bin (see
// niceBinWidth) is used and the label is a "from–to" range. Either way the
// rule actually used is returned as one sentence, stated in the chart's
// caption so the reader knows what a bar means without guessing.
const INTEGER_UNIT_BIN_RANGE_CAP = 20;
const HISTOGRAM_TARGET_BINS = 10;

export function computeHistogramBins(values) {
  const [min, max] = minMaxOf(values);
  const range = max - min;
  const allInteger = values.every(Number.isInteger);
  const unitBins = allInteger && range <= INTEGER_UNIT_BIN_RANGE_CAP;
  const width = unitBins ? 1 : niceBinWidth(range || 1, HISTOGRAM_TARGET_BINS);
  const start = unitBins ? min : Math.floor(min / width) * width;
  // Unit bins are INCLUSIVE of the max value as its own bar (min..max, one
  // integer each) — end has to be one past max, not max itself, or the
  // largest value would fold into the second-largest's bar instead of
  // getting the bar the spec's own example promises it.
  const end = unitBins ? max + 1 : Math.ceil(max / width) * width;
  const numBins = Math.max(1, Math.round((end - start) / width));
  const counts = new Array(numBins).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - start) / width);
    if (idx >= numBins) idx = numBins - 1; // the max value belongs in the last bin, inclusive
    if (idx < 0) idx = 0;
    counts[idx] += 1;
  }
  const bins = counts.map((count, i) => {
    const from = start + i * width;
    const to = from + width;
    return { label: unitBins ? fmtBinEdge(from) : `${fmtBinEdge(from)}–${fmtBinEdge(to)}`, from, to, count };
  });
  const binRule = unitBins
    ? "Each bar is one whole number — no value is split across bars."
    : `Each bar covers a range of ${fmtBinEdge(width)}, chosen so every bar is a round number.`;
  return { bins, binRule, binWidth: width, unitBins };
}

// P6-2: a histogram of one numeric column — "distribution of Duration_days",
// "durations chosen". No grouping column at all (that's what makes this
// different from every other dataset shape here): every readable number in
// valueCol becomes one tally in the bins computeHistogramBins builds. A cell
// that isn't a readable number is left out and counted honestly in
// `unreadableCount`, never silently treated as 0 or dropped without a trace.
export function buildHistogramDataset(sheet, valueCol, options = {}) {
  const { filter = null } = options;
  const rows = applyFilter(sheet.rows, filter);
  const values = [];
  let unreadableCount = 0;
  for (const r of rows) {
    const raw = r[valueCol];
    if (raw == null || String(raw).trim() === "") continue;
    const v = num(raw);
    if (Number.isFinite(v)) values.push(v);
    else unreadableCount += 1;
  }
  if (values.length === 0) {
    return { kind: "distribution", shape: "histogram", valueName: valueCol, bins: [], n: 0, filter, unreadableCount };
  }
  const { bins, binRule, binWidth, unitBins } = computeHistogramBins(values);
  return {
    kind: "distribution", shape: "histogram", valueName: valueCol,
    bins, binRule, binWidth, unitBins, n: values.length, filter,
    ...(unreadableCount ? { unreadableCount } : {}),
  };
}

// P6-2: box + jittered-dot plot — the spread of a numeric column WITHIN each
// group ("duration by diagnosis" as spread, not just the mean). Reuses
// computeNumericStats (the same quartile/median math the Q&A "describe"
// answer and its Excel formulas already use) per group — one brain, no
// second implementation. A group with zero readable numbers is left out and
// named in noDataGroups (never silently drawn as a zero-width box). Raw
// values are kept per group ONLY when there are few enough to draw as dots
// without the chart turning into a smear (BOXDOT_MAX_DOTS) — past that the
// box/median still draws, honestly labeled "box only" rather than a fake dot
// cloud.
const BOXDOT_MAX_DOTS = 50;

export function buildBoxDotDataset(sheet, labelCol, valueCol, options = {}) {
  const { filter = null } = options;
  const rows = applyFilter(sheet.rows, filter);
  const raw = new Map(); // foldKey -> { label, values }
  for (const r of rows) {
    const lRaw = r[labelCol];
    if (lRaw == null || String(lRaw).trim() === "") continue;
    const k = foldKey(lRaw);
    if (!raw.has(k)) raw.set(k, { label: String(lRaw), values: [] });
    const v = num(r[valueCol]);
    if (Number.isFinite(v)) raw.get(k).values.push(v);
  }
  const noDataGroups = [];
  const groups = [];
  for (const { label, values } of raw.values()) {
    if (values.length === 0) { noDataGroups.push(label); continue; }
    groups.push({
      label,
      stats: computeNumericStats(values),
      values: values.length <= BOXDOT_MAX_DOTS ? values : null,
      n: values.length,
    });
  }
  // House style: largest-first. A box+dot has no single "value" per group —
  // median is the closest analog to the average-by-group bar it's offered as
  // an alternative to, so groups sort by descending median.
  groups.sort((a, b) => (b.stats.median ?? 0) - (a.stats.median ?? 0));
  return {
    kind: "distribution", shape: "boxdot",
    labelName: labelCol, valueName: valueCol,
    groups, filter,
    ...(noDataGroups.length ? { noDataGroups } : {}),
  };
}
