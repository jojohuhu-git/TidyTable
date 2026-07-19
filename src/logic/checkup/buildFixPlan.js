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
  dedupeEncounterRows, keepOneRowPerPatient,
  isValidCalendarDate, NORMALIZERS, ROW_OPS, EXCEL_STEPS,
} from "./normalizers.js";

const CELL_NORMALIZERS = ["coerceNumbers", "sentinelBlanks", "parseDates", "trimCase", "censoredValues", "epochSerialToNumber", "stripUnitSuffix"];

const LIVE = { coerceNumbers, sentinelBlanks, parseDates, trimCase, censoredValues, splitList, epochSerialToNumber, stripUnitSuffix };

// Split the chosen fixes into the order they must run: value fixes, then
// duplicate removal (generic, then the encounter/patient row ops from parked
// item 3), then row-splitting.
function organize(fixes) {
  const cell = fixes.filter((f) => CELL_NORMALIZERS.includes(f.normalizer));
  const dedupe = fixes.find((f) => f.normalizer === "dedupeRows") || null;
  const encDedupe = fixes.find((f) => f.normalizer === "dedupeEncounters") || null;
  const patientCollapse = fixes.find((f) => f.normalizer === "keepOnePerPatient") || null;
  const split = fixes.filter((f) => f.normalizer === "splitList");
  return { cell, dedupe, encDedupe, patientCollapse, split };
}

function applyCell(fix, value) {
  if (fix.normalizer === "trimCase") return LIVE.trimCase(value, fix.params?.map || {});
  if (fix.normalizer === "censoredValues") return LIVE.censoredValues(value, fix.params?.policy || "boundary");
  if (fix.normalizer === "parseDates") return LIVE.parseDates(value, fix.params?.order || "MDY");
  return LIVE[fix.normalizer](value);
}

const rowSignature = (row, headers) => JSON.stringify(headers.map((h) => row[h.name]));

// Run the fixes on a copy of the rows and record what changed at each step.
// `removedRows` collects every row a dedupe step dropped, so the result card
// can show them — removed rows stay inspectable, never silently gone.
function simulate(sheet, fixes) {
  const { cell, dedupe, encDedupe, patientCollapse, split } = organize(fixes);
  let rows = sheet.rows.map((r) => ({ ...r }));
  const log = [];
  const removedRows = [];

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
      if (seen.has(sig)) { removedRows.push(r); return false; }
      seen.add(sig);
      return true;
    });
    log.push({
      action: "Removed duplicate rows", column: null, cellsChanged: 0,
      rowsBefore: before, rowsAfter: rows.length, rowsRemoved: before - rows.length,
    });
  }

  const names = sheet.headers.map((h) => h.name);
  if (encDedupe) {
    const before = rows.length;
    const kept = new Set(dedupeEncounterRows(rows, names, encDedupe.column));
    for (const r of rows) if (!kept.has(r)) removedRows.push(r);
    rows = rows.filter((r) => kept.has(r));
    log.push({
      action: `Removed exact-copy rows sharing the same "${encDedupe.column}"`,
      column: encDedupe.column, cellsChanged: 0,
      rowsBefore: before, rowsAfter: rows.length, rowsRemoved: before - rows.length,
    });
  }

  if (patientCollapse) {
    const before = rows.length;
    const policy = patientCollapse.params?.policy || "firstrow";
    const kept = new Set(keepOneRowPerPatient(rows, patientCollapse.column, policy, names));
    for (const r of rows) if (!kept.has(r)) removedRows.push(r);
    rows = rows.filter((r) => kept.has(r));
    log.push({
      action: `Kept one row per patient in "${patientCollapse.column}" (${policyLabel(policy)})`,
      column: patientCollapse.column, cellsChanged: 0,
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

  return { rows, log, removedRows };
}

// Plain-English name for a keepOnePerPatient policy, used in logs and scripts.
function policyLabel(policy) {
  const [mode, dateCol] = String(policy).split("::");
  if (mode === "first") return `earliest row by "${dateCol}"`;
  if (mode === "last") return `most recent row by "${dateCol}"`;
  if (mode === "complete") return "most complete row";
  if (mode === "lastrow") return "last row in the sheet";
  return "first row in the sheet";
}

function labelFor(fix) {
  switch (fix.normalizer) {
    case "coerceNumbers": return `Read text numbers in "${fix.column}" as numbers`;
    case "sentinelBlanks": return `Turned "not available" markers in "${fix.column}" into empty cells`;
    case "parseDates": return `Standardized the dates in "${fix.column}" to YYYY-MM-DD`;
    case "trimCase": return `Merged different spellings in "${fix.column}"`;
    case "censoredValues": return `Handled below/above-limit results in "${fix.column}" (${fix.params?.policy || "boundary"})`;
    case "dedupeEncounters": return `Removed exact-copy rows sharing the same "${fix.column}"`;
    case "keepOnePerPatient": return `Kept one row per patient in "${fix.column}" (${policyLabel(fix.params?.policy || "firstrow")})`;
    default: return `Cleaned "${fix.column}"`;
  }
}

// Build the JavaScript the worker runs on the full dataset. It inlines the exact
// source of each normalizer used, so browser and worker apply identical logic.
function buildTransformCode(sheet, fixes) {
  const { cell, dedupe, encDedupe, patientCollapse, split } = organize(fixes);
  const usedIds = new Set(cell.map((f) => f.normalizer));
  if (split.length) usedIds.add("splitList");

  const sources = [...usedIds].map((id) => NORMALIZERS[id].fn.toString());
  if (encDedupe) sources.push(ROW_OPS.dedupeEncounters.fn.toString());
  if (patientCollapse) sources.push(ROW_OPS.keepOnePerPatient.fn.toString());
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

  const headerNames = JSON.stringify(sheet.headers.map((h) => h.name));
  if (encDedupe) {
    lines.push(`rows = dedupeEncounterRows(rows, ${headerNames}, ${JSON.stringify(encDedupe.column)});`);
  }
  if (patientCollapse) {
    lines.push(`rows = keepOneRowPerPatient(rows, ${JSON.stringify(patientCollapse.column)}, ${JSON.stringify(patientCollapse.params?.policy || "firstrow")}, ${headerNames});`);
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
  const { cell, dedupe, encDedupe, patientCollapse, split } = organize(fixes);
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

  if (encDedupe) {
    // The app leaves exact copies whose ID cell is blank; Excel's Remove
    // Duplicates would take those too. Only warn when such rows exist.
    const allCopies = sheet.rows.length - new Set(sheet.rows.map((r) => rowSignature(r, sheet.headers))).size;
    const encCopies = sheet.rows.length - dedupeEncounterRows(sheet.rows, sheet.headers.map((h) => h.name), encDedupe.column).length;
    const blankIdNote = allCopies > encCopies
      ? ` One caution: your sheet also has ${allCopies - encCopies} exact-copy row${allCopies - encCopies === 1 ? "" : "s"} with a blank "${encDedupe.column}" — the app left ${allCopies - encCopies === 1 ? "it" : "them"} for your review, but Excel's Remove Duplicates would delete ${allCopies - encCopies === 1 ? "it" : "them"} too.`
      : "";
    steps.push({
      title: `Remove exact-copy rows sharing the same "${encDedupe.column}"`,
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction: `Select all your data, then use Data > Remove Duplicates (tick every column). Excel keeps the first copy of each fully-identical row and deletes the rest — the same rows the app removed. Rows that share a "${encDedupe.column}" but differ in any other cell are NOT touched: review those by hand.${blankIdNote}`,
    });
  }

  if (patientCollapse) {
    steps.push(...excelKeepOnePerPatient(sheet, patientCollapse, () => colLetter(helperIndex++), lastRow));
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

// Excel steps for "keep one row per patient". The recipe leans on one Excel
// fact: Remove Duplicates keeps the FIRST row of each duplicate group, so a
// sort that puts the surviving row first reproduces the app exactly (ties
// keep sheet order in both, since Excel's sort is stable).
function excelKeepOnePerPatient(sheet, fix, nextHelperLetter, lastRow) {
  const [mode, dateCol] = String(fix.params?.policy || "firstrow").split("::");
  const idCol = fix.column;
  const idHeader = sheet.headers.find((h) => h.name === idCol);
  const idLetter = idHeader?.letter || "A";
  const blankIds = sheet.rows.filter((r) => r[idCol] == null || String(r[idCol]).trim() === "").length;
  const blankNote = blankIds
    ? ` One caution: ${blankIds} row${blankIds === 1 ? "" : "s"} ha${blankIds === 1 ? "s" : "ve"} a blank "${idCol}" — the app keeps all of them, but Excel's Remove Duplicates would collapse them into one. Move those rows aside first, then paste them back after.`
    : "";
  const finish = `Then select all your data and use Data > Remove Duplicates, ticking ONLY the "${idCol}" column (${idLetter}). Excel keeps the first row of each patient — after this sort, that is the same row the app kept.${blankNote}`;

  if (mode === "first" || mode === "last") {
    const direction = mode === "first" ? "oldest first (A to Z / smallest to largest)" : "newest first (Z to A / largest to smallest)";
    return [{
      title: `Keep each patient's ${mode === "first" ? "earliest" : "most recent"} row by "${dateCol}"`,
      where: `Sheet "${sheet.name}"`,
      formula: "",
      instruction: `Sort your data by "${idCol}" (A to Z), then by "${dateCol}" ${direction} (Data > Sort, two levels). Rows with no date sort last, so a dated row survives over an undated one — same as the app. ${finish}`,
    }];
  }
  if (mode === "complete") {
    const helperLetter = nextHelperLetter();
    const firstDataLetter = sheet.headers[0]?.letter || "A";
    const lastDataLetter = sheet.headers[sheet.headers.length - 1]?.letter || "A";
    return [{
      title: `Keep each patient's most complete row`,
      where: `Sheet "${sheet.name}", cell ${helperLetter}2, then fill down to ${helperLetter}${lastRow}`,
      formula: `=COUNTA(${firstDataLetter}2:${lastDataLetter}2)`,
      instruction: `In a new column ${helperLetter}, this counts how many cells in the row are filled in. Fill it down over ${helperLetter}2:${helperLetter}${lastRow}. Sort by "${idCol}" (A to Z), then by column ${helperLetter} largest to smallest. ${finish}`,
    }];
  }
  // firstrow / lastrow: sheet order decides — no sort by date needed.
  return [{
    title: `Keep each patient's ${mode === "lastrow" ? "last" : "first"} row in the sheet`,
    where: `Sheet "${sheet.name}"`,
    formula: "",
    instruction: mode === "lastrow"
      ? `Reverse the sheet's row order first (add a helper column numbered 1, 2, 3…, then sort it largest to smallest). ${finish}`
      : `Keep the rows in their current order. ${finish}`,
  }];
}

// Parked item 3d: a real R script for the row-removal steps. The per-cell
// value fixes keep their existing home in the Excel steps; when both kinds
// are picked together the script says plainly what it covers.
function buildRScript(sheet, fixes) {
  const { cell, dedupe, encDedupe, patientCollapse, split } = organize(fixes);
  if (!encDedupe && !patientCollapse) {
    return {
      r_script:
        "# This cleanup was done inside TidyTable, on your computer.\n" +
        "# The result table and the Excel steps above reproduce it exactly.\n" +
        "# A full R version of these cleaning steps arrives with the statistics features.\n",
      r_run_notes:
        "This cleanup ran on your computer, so there is no R script to run for it yet. " +
        "Use the Excel steps to reproduce the same result by hand, or download the cleaned file directly.",
    };
  }
  const key = (name) => `data[["${String(name).replace(/"/g, '\\"')}"]]`;
  const otherFixes = cell.length + (dedupe ? 1 : 0) + split.length;
  const lines = [
    "# ----------------------------------------------------------------------",
    "# How to use this: open RStudio, click once in the Console (the pane with",
    '# a ">" prompt), paste this whole script, and press Enter.',
    "# ----------------------------------------------------------------------",
    "",
    "# Install what we need only if it is missing (safe on a brand-new computer).",
    'if (!require("readxl")) install.packages("readxl")',
    "library(readxl)",
    "",
    "# Pick your ORIGINAL spreadsheet from the normal file window.",
    "data <- read_excel(file.choose())",
    "",
  ];
  if (otherFixes) {
    lines.push(
      `# Note: this script covers the row-removal step${encDedupe && patientCollapse ? "s" : ""} only.`,
      `# The other ${otherFixes} fix${otherFixes === 1 ? "" : "es"} you chose (value cleanups) are reproduced by the Excel`,
      "# steps — do those first if you want this script's row counts to match exactly.",
      "",
    );
  }
  if (encDedupe) {
    const c = encDedupe.column;
    lines.push(
      `# Remove rows that are exact copies of an earlier row AND have a non-blank "${c}".`,
      `# Rows sharing a "${c}" but differing in any cell are kept for review.`,
      `has_id <- !is.na(${key(c)}) & trimws(as.character(${key(c)})) != ""`,
      "data <- data[!(duplicated(data) & has_id), ]",
      'cat("Rows after removing exact copies:", nrow(data), "\\n")',
      "",
    );
  }
  if (patientCollapse) {
    const c = patientCollapse.column;
    const [mode, dateCol] = String(patientCollapse.params?.policy || "firstrow").split("::");
    lines.push(
      `# Keep one row per patient in "${c}": the ${policyLabel(patientCollapse.params?.policy || "firstrow")}.`,
      "# Rows with a blank patient ID are all kept. Ties keep the earlier row.",
      `ids <- trimws(as.character(${key(c)})); ids[is.na(${key(c)})] <- ""`,
    );
    if (mode === "first" || mode === "last") {
      lines.push(
        `score <- suppressWarnings(as.numeric(as.POSIXct(as.character(${key(dateCol)}), tz = "UTC")))`,
        `score[is.na(score)] <- ${mode === "first" ? "Inf" : "-Inf"}  # a row with no date loses to a dated one`,
      );
    } else if (mode === "complete") {
      lines.push(
        "score <- apply(data, 1, function(r) sum(!is.na(r) & trimws(as.character(r)) != \"\"))",
      );
    } else if (mode === "lastrow") {
      lines.push("score <- seq_len(nrow(data))");
    } else {
      lines.push("score <- -seq_len(nrow(data))");
    }
    lines.push(
      "keep <- rep(TRUE, nrow(data))",
      'for (u in unique(ids[ids != ""])) {',
      "  idx <- which(ids == u)",
      "  if (length(idx) < 2) next",
      `  pick <- idx[${mode === "first" ? "which.min(score[idx])" : "which.max(score[idx])"}]  # first match = earlier row wins ties`,
      "  keep[setdiff(idx, pick)] <- FALSE",
      "}",
      "data <- data[keep, ]",
      'cat("Rows after keeping one per patient:", nrow(data), "\\n")',
      "",
    );
  }
  return {
    r_script: lines.join("\n") + "\n",
    r_run_notes:
      "This script re-does the row-removal on your ORIGINAL file so you can check the app. " +
      "The printed row counts should match the cleaning log above. " +
      "Nothing else about your file is changed, and nothing leaves your computer.",
  };
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

// Public: fixes = [{ normalizer, column, params }]. Returns { plan, log,
// cleanedRows, removedRows } — removedRows so a dedupe's dropped rows stay
// inspectable on the result card, never silently gone.
export function buildFixPlan(sheet, fixes) {
  const { rows, log, removedRows } = simulate(sheet, fixes);
  const { r_script, r_run_notes } = buildRScript(sheet, fixes);
  const plan = {
    engine: "offline",
    summary: buildSummary(sheet, fixes, log),
    transform_code: buildTransformCode(sheet, fixes),
    excel_steps: buildExcelSteps(sheet, fixes),
    r_script,
    r_run_notes,
  };
  return { plan, log, cleanedRows: rows, removedRows };
}
