// Turn two chosen columns into the dataset the chart advisor and preview use
// (build prompt §11). Two number columns stay as raw points for a scatter;
// otherwise the label column is grouped and each group gets a count, or the total
// of a numeric value column. Month/date labels are flagged so the advisor can
// prefer a line.

import { foldKey } from "../checkup/normalizers.js";

const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

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
    const points = [];
    for (const r of sheet.rows) {
      const x = num(r[labelCol]);
      const y = num(r[valueCol]);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
    }
    return { kind: "xy", points, xName: labelCol, yName: valueCol };
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
