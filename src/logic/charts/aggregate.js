// Turn two chosen columns into the dataset the chart advisor and preview use
// (build prompt §11). Two number columns stay as raw points for a scatter;
// otherwise the label column is grouped and each group gets a count, or the total
// of a numeric value column. Month/date labels are flagged so the advisor can
// prefer a line.

import { foldKey } from "../checkup/normalizers.js";
import { toNumber, topNWithTies } from "../offline/cohort.js";

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
