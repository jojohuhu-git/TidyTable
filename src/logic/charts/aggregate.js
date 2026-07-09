// Turn two chosen columns into the dataset the chart advisor and preview use
// (build prompt §11). Two number columns stay as raw points for a scatter;
// otherwise the label column is grouped and each group gets a count, or the total
// of a numeric value column. Month/date labels are flagged so the advisor can
// prefer a line.

import { foldKey } from "../checkup/normalizers.js";

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

const num = (v) => (typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, "")));

// sheet: { headers, rows }. valueCol may be null → count per label.
export function buildDataset(sheet, labelCol, valueCol) {
  const labelNum = isNumericColumn(sheet, labelCol);
  const valueNum = valueCol ? isNumericColumn(sheet, valueCol) : false;

  // Two number columns → scatter of raw points.
  if (valueCol && labelNum && valueNum) {
    const raw = [];
    for (const r of sheet.rows) {
      const x = num(r[labelCol]);
      const y = num(r[valueCol]);
      if (Number.isFinite(x) && Number.isFinite(y)) raw.push({ x, y });
    }
    const points = samplePoints(raw, SCATTER_POINT_CAP);
    return {
      kind: "xy", points, xName: labelCol, yName: valueCol,
      totalPoints: raw.length, sampled: points.length < raw.length,
    };
  }

  // Otherwise group by the label column.
  const groups = new Map(); // foldKey -> { label, value }
  for (const r of sheet.rows) {
    const raw = r[labelCol];
    if (raw == null || String(raw).trim() === "") continue;
    const k = foldKey(raw);
    if (!groups.has(k)) groups.set(k, { label: String(raw), value: 0 });
    const g = groups.get(k);
    if (valueCol && valueNum) {
      const v = num(r[valueCol]);
      if (Number.isFinite(v)) g.value += v;
    } else {
      g.value += 1;
    }
  }
  let points = [...groups.values()];
  const labelIsTime = labelsLookLikeTime(sheet, labelCol);
  if (labelIsTime) {
    const keys = points.map((p) => timeSortKey(p.label));
    if (keys.every((k) => k != null)) {
      points = points
        .map((p, i) => ({ p, k: keys[i] }))
        .sort((a, b) => a.k - b.k)
        .map(({ p }) => p);
    }
  }
  return {
    kind: "categorical",
    points,
    labelIsTime,
    valueName: valueCol && valueNum ? `total ${valueCol}` : "count",
    labelName: labelCol,
  };
}
