// Turn two chosen columns into the dataset the chart advisor and preview use
// (build prompt §11). Two number columns stay as raw points for a scatter;
// otherwise the label column is grouped and each group gets a count, or the total
// of a numeric value column. Month/date labels are flagged so the advisor can
// prefer a line.

import { foldKey } from "../checkup/normalizers.js";

const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

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
  const points = [...groups.values()];
  return {
    kind: "categorical",
    points,
    labelIsTime: labelsLookLikeTime(sheet, labelCol),
    valueName: valueCol && valueNum ? `total ${valueCol}` : "count",
    labelName: labelCol,
  };
}
