import * as XLSX from "xlsx";
import { colLetter } from "./letters.js";

// Convert a raw cell to a JSON-friendly value.
// Dates become ISO strings ("YYYY-MM-DD" or full ISO if there's a time part).
function normalizeCell(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const hasTime =
      v.getHours() !== 0 || v.getMinutes() !== 0 || v.getSeconds() !== 0;
    const pad = (x) => String(x).padStart(2, "0");
    const day = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    return hasTime ? `${day} ${pad(v.getHours())}:${pad(v.getMinutes())}` : day;
  }
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  return v;
}

function inferType(values) {
  const nonNull = values.filter((v) => v != null);
  if (nonNull.length === 0) return "empty";
  if (nonNull.every((v) => typeof v === "number")) return "number";
  if (nonNull.every((v) => typeof v === "boolean")) return "true/false";
  if (
    nonNull.every(
      (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v),
    )
  )
    return "date";
  if (nonNull.some((v) => typeof v === "number")) return "mixed (text + numbers)";
  return "text";
}

// Parse an uploaded .xlsx/.xls/.csv File into:
// { fileName, sheets: [{ name, headers: [{letter, name, type, samples}], rows, rowCount }] }
export async function parseWorkbookFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheets = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (matrix.length === 0) continue;

    // Build unique header names from the first row.
    const rawHeader = matrix[0] || [];
    const width = Math.max(rawHeader.length, ...matrix.map((r) => r.length));
    const seen = new Map();
    const headerNames = [];
    for (let i = 0; i < width; i++) {
      let h = rawHeader[i];
      h = h == null || String(h).trim() === "" ? `Column ${colLetter(i)}` : String(h).trim();
      const count = seen.get(h) || 0;
      seen.set(h, count + 1);
      headerNames.push(count === 0 ? h : `${h} (${count + 1})`);
    }

    const rows = [];
    for (let r = 1; r < matrix.length; r++) {
      const src = matrix[r] || [];
      let allNull = true;
      const obj = {};
      for (let i = 0; i < width; i++) {
        const val = normalizeCell(src[i]);
        obj[headerNames[i]] = val;
        if (val != null) allNull = false;
      }
      if (!allNull) rows.push(obj);
    }

    const headers = headerNames.map((h, i) => {
      const colValues = rows.slice(0, 500).map((row) => row[h]);
      const samples = [];
      for (const v of colValues) {
        if (v == null) continue;
        const s = typeof v === "string" ? v : String(v);
        if (!samples.includes(s)) samples.push(s);
        if (samples.length >= 4) break;
      }
      return { letter: colLetter(i), name: h, type: inferType(colValues), samples };
    });

    if (rows.length > 0) {
      sheets.push({ name, headers, rows, rowCount: rows.length });
    }
  }

  if (sheets.length === 0) {
    throw new Error("No data found in this file. Make sure the first row of each sheet contains column headers.");
  }
  return { fileName: file.name, sheets };
}

// Rebuild a sheet object (headers, types, samples, rowCount) from a list of row
// objects — used after checkup fixes replace a sheet's data with cleaned rows,
// so later steps see the cleaned version.
export function deriveSheet(name, rows) {
  const headerNames = rows.length ? Object.keys(rows[0]) : [];
  const headers = headerNames.map((h, i) => {
    const colValues = rows.slice(0, 500).map((row) => row[h]);
    const samples = [];
    for (const v of colValues) {
      if (v == null) continue;
      const s = typeof v === "string" ? v : String(v);
      if (!samples.includes(s)) samples.push(s);
      if (samples.length >= 4) break;
    }
    return { letter: colLetter(i), name: h, type: inferType(colValues), samples };
  });
  return { name, headers, rows, rowCount: rows.length };
}

export function downloadRowsAsXlsx(rows, fileName = "TidyTable_result.xlsx") {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Result");
  XLSX.writeFile(wb, fileName);
}

export function downloadRowsAsCsv(rows, fileName = "TidyTable_result.csv") {
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadText(text, fileName, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}
