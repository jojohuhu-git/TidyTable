// Turn the fixes the user picked into an offline plan (build prompt §6/§12).
// Output is PLAN_SCHEMA-shaped (plus engine:"offline") so the existing worker +
// ResultsPanel apply and show it unchanged. We also return cleaning-log entries
// with real before/after row counts, computed by running the very same pure
// normalizer functions the transform inlines — so the log can never disagree
// with the data.

import { colLetter } from "../letters.js";
import { excelRowExtent, excelRowExtentNote } from "../workbook.js";
import {
  coerceNumbers, sentinelBlanks, parseDates, trimCase, censoredValues, splitList, epochSerialToNumber, stripUnitSuffix,
  isValidCalendarDate, NORMALIZERS, EXCEL_STEPS,
} from "./normalizers.js";

const CELL_NORMALIZERS = ["coerceNumbers", "sentinelBlanks", "parseDates", "trimCase", "censoredValues", "epochSerialToNumber", "stripUnitSuffix"];

const LIVE = { coerceNumbers, sentinelBlanks, parseDates, trimCase, censoredValues, splitList, epochSerialToNumber, stripUnitSuffix };

// Split the chosen fixes into the order they must run: value fixes, then
// duplicate removal, then row-splitting.
function organize(fixes) {
  const cell = fixes.filter((f) => CELL_NORMALIZERS.includes(f.normalizer));
  const dedupe = fixes.find((f) => f.normalizer === "dedupeRows") || null;
  const split = fixes.filter((f) => f.normalizer === "splitList");
  return { cell, dedupe, split };
}

function applyCell(fix, value) {
  if (fix.normalizer === "trimCase") return LIVE.trimCase(value, fix.params?.map || {});
  if (fix.normalizer === "censoredValues") return LIVE.censoredValues(value, fix.params?.policy || "boundary");
  if (fix.normalizer === "parseDates") return LIVE.parseDates(value, fix.params?.order || "MDY");
  return LIVE[fix.normalizer](value);
}

const rowSignature = (row, headers) => JSON.stringify(headers.map((h) => row[h.name]));

// Run the fixes on a copy of the rows and record what changed at each step.
function simulate(sheet, fixes) {
  const { cell, dedupe, split } = organize(fixes);
  let rows = sheet.rows.map((r) => ({ ...r }));
  const log = [];

  for (const fix of cell) {
    let changed = 0;
    for (const r of rows) {
      const before = r[fix.column];
      const after = applyCell(fix, before);
      if (after !== before) { r[fix.column] = after; changed++; }
    }
    log.push({
      action: labelFor(fix), column: fix.column, cellsChanged: changed,
      rowsBefore: rows.length, rowsAfter: rows.length,
    });
  }

  if (dedupe) {
    const before = rows.length;
    const seen = new Set();
    rows = rows.filter((r) => {
      const sig = rowSignature(r, sheet.headers);
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    log.push({
      action: "Removed duplicate rows", column: null, cellsChanged: 0,
      rowsBefore: before, rowsAfter: rows.length, rowsRemoved: before - rows.length,
    });
  }

  for (const fix of split) {
    const before = rows.length;
    const out = [];
    for (const r of rows) {
      for (const part of LIVE.splitList(r[fix.column])) out.push({ ...r, [fix.column]: part });
    }
    rows = out;
    log.push({
      action: `Split multi-value cells in "${fix.column}" into separate rows`,
      column: fix.column, cellsChanged: 0,
      rowsBefore: before, rowsAfter: rows.length, rowsAdded: rows.length - before,
    });
  }

  return { rows, log };
}

function labelFor(fix) {
  switch (fix.normalizer) {
    case "coerceNumbers": return `Read text numbers in "${fix.column}" as numbers`;
    case "sentinelBlanks": return `Turned "not available" markers in "${fix.column}" into empty cells`;
    case "parseDates": return `Standardized the dates in "${fix.column}" to YYYY-MM-DD`;
    case "trimCase": return `Merged different spellings in "${fix.column}"`;
    case "censoredValues": return `Handled below/above-limit results in "${fix.column}" (${fix.params?.policy || "boundary"})`;
    default: return `Cleaned "${fix.column}"`;
  }
}

// Build the JavaScript the worker runs on the full dataset. It inlines the exact
// source of each normalizer used, so browser and worker apply identical logic.
function buildTransformCode(sheet, fixes) {
  const { cell, dedupe, split } = organize(fixes);
  const usedIds = new Set(cell.map((f) => f.normalizer));
  if (split.length) usedIds.add("splitList");

  const sources = [...usedIds].map((id) => NORMALIZERS[id].fn.toString());
  // parseDates calls isValidCalendarDate (see normalizers.js) so its source
  // must ride along whenever parseDates does — function declarations hoist,
  // so the order here doesn't matter, only that it's present.
  if (usedIds.has("parseDates")) sources.push(isValidCalendarDate.toString());
  const lines = [];
  lines.push(...sources);
  lines.push(`var rows = (sheets[${JSON.stringify(sheet.name)}] || []).map(function (r) { return Object.assign({}, r); });`);

  for (const fix of cell) {
    const col = JSON.stringify(fix.column);
    if (fix.normalizer === "trimCase") {
      lines.push(`for (var i = 0; i < rows.length; i++) { rows[i][${col}] = trimCase(rows[i][${col}], ${JSON.stringify(fix.params?.map || {})}); }`);
    } else if (fix.normalizer === "censoredValues") {
      lines.push(`for (var i = 0; i < rows.length; i++) { rows[i][${col}] = censoredValues(rows[i][${col}], ${JSON.stringify(fix.params?.policy || "boundary")}); }`);
    } else if (fix.normalizer === "parseDates") {
      lines.push(`for (var i = 0; i < rows.length; i++) { rows[i][${col}] = parseDates(rows[i][${col}], ${JSON.stringify(fix.params?.order || "MDY")}); }`);
    } else {
      lines.push(`for (var i = 0; i < rows.length; i++) { rows[i][${col}] = ${fix.normalizer}(rows[i][${col}]); }`);
    }
  }

  if (dedupe) {
    const keys = JSON.stringify(sheet.headers.map((h) => h.name));
    lines.push(`(function () { var seen = {}; var out = []; var keys = ${keys};`);
    lines.push(`  for (var i = 0; i < rows.length; i++) { var sig = JSON.stringify(keys.map(function (k) { return rows[i][k]; })); if (!seen[sig]) { seen[sig] = 1; out.push(rows[i]); } }`);
    lines.push(`  rows = out; })();`);
  }

  for (const fix of split) {
    const col = JSON.stringify(fix.column);
    lines.push(`(function () { var out = []; for (var i = 0; i < rows.length; i++) { var parts = splitList(rows[i][${col}]); for (var j = 0; j < parts.length; j++) { var c = Object.assign({}, rows[i]); c[${col}] = parts[j]; out.push(c); } } rows = out; })();`);
  }

  lines.push(`return rows;`);
  return lines.join("\n");
}

// Excel helper-column steps: one (or more) per fix, using fresh helper columns.
function buildExcelSteps(sheet, fixes) {
  const { cell, dedupe, split } = organize(fixes);
  const extent = excelRowExtent(sheet);
  const lastRow = extent.lastRow;
  let helperIndex = sheet.headers.length; // first free column after the data
  const steps = [];

  for (const fix of cell) {
    const header = sheet.headers.find((h) => h.name === fix.column);
    const ctx = {
      sheetName: sheet.name, colName: fix.column, letter: header?.letter || "A",
      helperLetter: colLetter(helperIndex++), lastRow, params: fix.params,
    };
    // P1-8: trimCase's pasted lookup table needs two more columns. Allocate
    // them from the same helperIndex sequence (instead of hardcoding Y/Z) so
    // they can't collide with real data on a wide sheet or with another
    // fix's own helper column.
    if (fix.normalizer === "trimCase") {
      ctx.lookupFromLetter = colLetter(helperIndex++);
      ctx.lookupToLetter = colLetter(helperIndex++);
    }
    steps.push(...EXCEL_STEPS[fix.normalizer](ctx));
  }

  if (dedupe) {
    steps.push({
      title: "Remove duplicate rows",
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction: "Select all your data, then use Data > Remove Duplicates (tick every column). Excel keeps the first copy of each row and deletes the rest — the same rows the app removed.",
    });
  }

  for (const fix of split) {
    const header = sheet.headers.find((h) => h.name === fix.column);
    steps.push(...EXCEL_STEPS.splitList({ sheetName: sheet.name, colName: fix.column, letter: header?.letter || "A" }));
  }

  // P1-9: a sheet with leading rows before the header, or blank rows dropped
  // from inside the data, needs the reader to know the ranges above cover
  // the sheet's real extent, not just "row 2 to rows.length+1".
  if (extent.needsNote && steps.length) {
    steps[0] = { ...steps[0], instruction: `${excelRowExtentNote(extent)} ${steps[0].instruction}` };
  }

  return steps;
}

function buildSummary(sheet, fixes, log) {
  const final = log.length ? log[log.length - 1].rowsAfter : sheet.rows.length;
  const parts = [
    `Cleaned the sheet "${sheet.name}" on this computer, applying ${fixes.length} fix${fixes.length === 1 ? "" : "es"} you chose.`,
    `Started with ${sheet.rows.length} rows and ended with ${final} rows.`,
    "Nothing was sent anywhere. Each change is listed in the cleaning log, and the Excel steps reproduce them by hand.",
  ];
  return parts.join(" ");
}

// Public: fixes = [{ normalizer, column, params }]. Returns { plan, log }.
export function buildFixPlan(sheet, fixes) {
  const { rows, log } = simulate(sheet, fixes);
  const plan = {
    engine: "offline",
    summary: buildSummary(sheet, fixes, log),
    transform_code: buildTransformCode(sheet, fixes),
    excel_steps: buildExcelSteps(sheet, fixes),
    r_script:
      "# This cleanup was done inside TidyTable, on your computer.\n" +
      "# The result table and the Excel steps above reproduce it exactly.\n" +
      "# A full R version of these cleaning steps arrives with the statistics features.\n",
    r_run_notes:
      "This cleanup ran on your computer, so there is no R script to run for it yet. " +
      "Use the Excel steps to reproduce the same result by hand, or download the cleaned file directly.",
  };
  return { plan, log, cleanedRows: rows };
}
