import * as XLSX from "xlsx";
import { colLetter } from "./letters.js";
import { coerceNumbers } from "./checkup/normalizers.js";
import { extractColumnVocabularies, colToIndex } from "./vocab/validationLists.js";

// CSV/TSV field-type guessing (SheetJS's own date/number inference on raw text)
// happens before the checkup layer ever sees a cell, and disagrees with it: it
// silently decided "3/6/2024" means March 6, and turned "<0.5" into a date
// entirely. For delimited text files we read every cell as a literal string
// instead (raw: true), then coerce only unambiguous, clean numeric strings
// ourselves with the same normalizer the cleaning step uses — so a censored
// value or an ambiguous date reaches the checkup/normalizer layer untouched,
// which shows its work and asks, rather than guessing silently.
function isDelimitedText(file) {
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".csv") || name.endsWith(".tsv")
    || file.type === "text/csv" || file.type === "text/tab-separated-values";
}

// Convert a raw cell to a JSON-friendly value.
// Dates become ISO strings ("YYYY-MM-DD" or full ISO if there's a time part).
// coerceNumericText: for CSV/TSV cells (which arrive as literal strings, see
// isDelimitedText above), also read an unambiguous clean numeric string as a
// real number, exactly like the cleaning step's coerceNumbers would — but
// anything not a clean number (a censored value, a date, plain text) stays a
// string for the checkup layer to interpret, never guessed here.
function normalizeCell(v, coerceNumericText) {
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
    if (t === "") return null;
    return coerceNumericText ? coerceNumbers(t) : t;
  }
  return v;
}

// P4-2: the same sentinel-blank tokens normalizers.js's sentinelBlanks()
// recognizes ("N/A", "none", "-", "."). A date column where the Step 2 date
// fix was applied but the "missing values" fix wasn't left may still have a
// few of these as literal text (never silently rewritten, per parseDates'
// own honesty rule) — that alone shouldn't stop the whole column from being
// typed "date", the same way a stray "N/A" doesn't stop a numeric column
// from being typed "number"/"mixed" rather than falling back to "text".
const DATE_BLANK_SENTINELS = new Set(["", "n/a", "na", "none", "-", "."]);
const isIsoDateString = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
const isDateBlankLike = (v) => typeof v === "string" && DATE_BLANK_SENTINELS.has(v.trim().toLowerCase());

function inferType(values) {
  const nonNull = values.filter((v) => v != null);
  if (nonNull.length === 0) return "empty";
  if (nonNull.every((v) => typeof v === "number")) return "number";
  if (nonNull.every((v) => typeof v === "boolean")) return "true/false";
  if (nonNull.some(isIsoDateString) && nonNull.every((v) => isIsoDateString(v) || isDateBlankLike(v)))
    return "date";
  if (nonNull.some((v) => typeof v === "number")) return "mixed (text + numbers)";
  return "text";
}

// Parse an uploaded .xlsx/.xls/.csv File into:
// { fileName, sheets: [{ name, headers: [{letter, name, type, samples}], rows, rowCount }] }
export async function parseWorkbookFile(file) {
  const delimited = isDelimitedText(file);
  const buffer = delimited ? null : await file.arrayBuffer();
  const wb = delimited
    ? XLSX.read(await file.text(), { type: "string", raw: true })
    : XLSX.read(buffer, { cellDates: true });
  const sheets = [];
  // P4-3: remember where each sheet's used range starts so a picklist found on
  // sheet column "C" can be mapped to the right parsed header even when the
  // data doesn't begin at column A.
  const sheetStartCol = new Map();

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (matrix.length === 0) continue;

    // P1-9: `sheet_to_json` starts at the sheet's used range, which may not be
    // row 1 (leading blank rows, or content that doesn't start at A1). Record
    // the real physical row numbers so Excel-step ranges and the AI context
    // can reference the sheet's actual extent instead of always assuming
    // "row 2 to rows.length+1".
    const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { s: { r: 0 }, e: { r: matrix.length - 1 } };
    sheetStartCol.set(name, range.s.c ?? 0);
    const excelHeaderRow = range.s.r + 1; // 1-indexed, matches Excel's own row numbers
    const excelFirstDataRow = excelHeaderRow + 1;
    const excelLastRow = range.e.r + 1;

    // Build unique header names from the first row. P2-17: renaming a repeat
    // of "Name" to "Name (2)" can collide with a real column already named
    // "Name (2)", silently overwriting one of them — keep incrementing until
    // the candidate is actually free, checked against every name used so far.
    const rawHeader = matrix[0] || [];
    const width = Math.max(rawHeader.length, ...matrix.map((r) => r.length));
    const usedNames = new Set();
    const headerNames = [];
    for (let i = 0; i < width; i++) {
      let h = rawHeader[i];
      h = h == null || String(h).trim() === "" ? `Column ${colLetter(i)}` : String(h).trim();
      let candidate = h;
      let n = 2;
      while (usedNames.has(candidate)) candidate = `${h} (${n++})`;
      usedNames.add(candidate);
      headerNames.push(candidate);
    }

    const rows = [];
    let droppedBlankRows = 0;
    for (let r = 1; r < matrix.length; r++) {
      const src = matrix[r] || [];
      let allNull = true;
      const obj = {};
      for (let i = 0; i < width; i++) {
        const val = normalizeCell(src[i], delimited);
        obj[headerNames[i]] = val;
        if (val != null) allNull = false;
      }
      if (!allNull) rows.push(obj);
      else droppedBlankRows++;
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
      sheets.push({
        name, headers, rows, rowCount: rows.length,
        excelFirstDataRow, excelLastRow, droppedBlankRows,
      });
    }
  }

  if (sheets.length === 0) {
    throw new Error("No data found in this file. Make sure the first row of each sheet contains column headers.");
  }

  // P4-3: if this is a zip-based Excel file (.xlsx/.xlsm start with "PK"),
  // read its data-validation picklists and attach them per sheet as
  // sheet.vocab = { headerName: [legal terms] }. Purely additive metadata —
  // if the workbook has no picklists (or the XML can't be parsed) the upload
  // proceeds exactly as before, same as a CSV.
  if (buffer && new Uint8Array(buffer, 0, 2)[0] === 0x50 && new Uint8Array(buffer, 0, 2)[1] === 0x4b) {
    try {
      const vocabs = await extractColumnVocabularies(buffer);
      for (const { sheetName, colLetter: col, terms } of vocabs) {
        const sheet = sheets.find((s) => s.name === sheetName);
        if (!sheet) continue;
        const idx = colToIndex(col) - (sheetStartCol.get(sheetName) || 0);
        const header = sheet.headers[idx];
        if (!header) continue;
        if (!sheet.vocab) sheet.vocab = {};
        sheet.vocab[header.name] = terms;
      }
    } catch {
      // A picklist we can't read is the same as no picklist — never block the upload.
    }
  }

  return { fileName: file.name, sheets };
}

// P1-9: every Excel-step generator needs the sheet's real physical row
// extent, not just "row 2 to rows.length+1" — that assumption breaks
// whenever the sheet has leading rows before the header or blank rows
// dropped from inside the data. parseWorkbookFile records the real numbers;
// a sheet rebuilt by deriveSheet (e.g. after checkup fixes) has no leftover
// physical file to reference, so it falls back to the tidy default.
export function excelRowExtent(sheet) {
  const firstDataRow = sheet.excelFirstDataRow ?? 2;
  const lastRow = sheet.excelLastRow ?? sheet.rows.length + 1;
  const droppedBlankRows = sheet.droppedBlankRows ?? 0;
  const needsNote = droppedBlankRows > 0 || firstDataRow !== 2;
  return { firstDataRow, lastRow, droppedBlankRows, needsNote };
}

// The one-sentence honesty note (P1-9) prepended to the first Excel step
// whenever the sheet isn't perfectly tidy, so "fill down to row N" ranges are
// visibly trustworthy rather than silently short or shifted.
export function excelRowExtentNote(extent) {
  const parts = [];
  if (extent.firstDataRow !== 2) {
    parts.push(`this sheet's header is in row ${extent.firstDataRow - 1}, not row 1`);
  }
  if (extent.droppedBlankRows > 0) {
    parts.push(`${extent.droppedBlankRows} blank row${extent.droppedBlankRows === 1 ? "" : "s"} inside the data were skipped`);
  }
  return `Your file isn't perfectly tidy: ${parts.join(", and ")}. The ranges below go to row ${extent.lastRow} to cover the sheet's real extent.`;
}

// Rebuild a sheet object (headers, types, samples, rowCount) from a list of row
// objects — used after checkup fixes replace a sheet's data with cleaned rows,
// so later steps see the cleaned version. Pass the sheet being replaced as
// `prev` to carry its picklist vocabularies (P4-3) over to the columns that
// still exist — cleaning rows doesn't change what terms Excel allows.
export function deriveSheet(name, rows, prev = null) {
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
  const sheet = { name, headers, rows, rowCount: rows.length };
  if (prev?.vocab) {
    const kept = {};
    for (const h of headerNames) if (prev.vocab[h]) kept[h] = prev.vocab[h];
    if (Object.keys(kept).length) sheet.vocab = kept;
  }
  return sheet;
}

export function downloadRowsAsXlsx(rows, fileName = "TidyTable_result.xlsx") {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Result");
  XLSX.writeFile(wb, fileName);
}

// W1: Step 2's "download your fixed file" button. Builds a single real .xlsx
// from every sheet in the in-memory workbook — the cleaned first sheet plus any
// other sheets untouched — using the same xlsx lib as the rest of the app.
// Formatting (cell colors, column widths) is not preserved — only the data —
// since the workbook object never carried that information past
// parseWorkbookFile in the first place. Split from the download wrapper so the
// exported workbook can be inspected directly in tests without file I/O.
export function buildWorkbookXlsx(workbook) {
  const wb = XLSX.utils.book_new();
  for (const sheet of workbook.sheets) {
    // Pin the column order (and keep an all-blank column present) to the sheet's
    // own header list, so the exported sheet mirrors what the user sees rather
    // than whatever key order the first row object happens to have.
    const headerNames = (sheet.headers || []).map((h) => h.name);
    const ws = headerNames.length
      ? XLSX.utils.json_to_sheet(sheet.rows, { header: headerNames })
      : XLSX.utils.json_to_sheet(sheet.rows);
    // Excel sheet names are max 31 chars, forbid a few characters, and must be
    // unique — sanitize and de-duplicate so book_append_sheet never throws.
    let base = String(sheet.name || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
    let candidate = base;
    let n = 2;
    while (wb.SheetNames.includes(candidate)) {
      const suffix = ` (${n++})`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }
    XLSX.utils.book_append_sheet(wb, ws, candidate);
  }
  return wb;
}

export function downloadWorkbookAsXlsx(workbook, fileName = "TidyTable_workbook.xlsx") {
  XLSX.writeFile(buildWorkbookXlsx(workbook), fileName);
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
