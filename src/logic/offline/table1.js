// Phase 7.5 (plan-2026-07-10-offline-smarts.md) — the Table-1 builder.
//
// "summarize diagnosis, drug and duration" is the clinical end-goal: one
// publication-style descriptive table a clinician pastes straight into a paper.
// Standard biostatistics conventions (not invented here): each CATEGORICAL
// column is reported as n (%) per level; each NUMERIC column as median (IQR)
// with mean (SD) alongside; missing/unreadable counts are reported per column.
//
// This composes Phase 2's stats + clinical formats into the deliverable, and
// stays offline and deterministic. Nothing here guesses a column — the matcher
// only reaches this path when 2+ columns resolved confidently.

import { foldKey } from "../checkup/normalizers.js";
import { computeNumericStats, toNumber, rankFrequency } from "./cohort.js";
import { inferColumnUnit } from "./units.js";
import { formatNPercent } from "./clinicalFormat.js";

// The header types (workbook.js inferType) a numeric summary can run on — same
// set the matcher and charts use.
const NUMERIC_TYPES = new Set(["number", "mixed (text + numbers)"]);

export function isNumericColumn(header) {
  return Boolean(header && header.type && NUMERIC_TYPES.has(header.type));
}

// The numeric one-liner for a Table-1 row, in clinical style. Pure and
// self-contained (only its args + a template), so fillPlan.js can inline its
// exact source via toString() into the worker transform — the app-side and the
// replayed table must never drift. `unit` labels the median headline only.
export function numericSummaryText(stats, unit) {
  if (!stats || stats.n === 0 || stats.median == null) return "no readable numbers";
  var u = unit ? " " + unit : "";
  var sd = stats.sd == null ? "n/a" : stats.sd;
  return "median " + stats.median + u + " (IQR " + stats.q1 + "–" + stats.q3 + "); mean " + stats.mean + " (SD " + sd + ")";
}

// Run a Table-1 match over the rows: per named column, the full stats bundle
// (numeric) or the frequency table (categorical), plus a per-column missing
// count. No filter stages — a Table-1 describes the whole sheet.
export function executeTable1(match, workbook) {
  const sheet = workbook.sheets.find((s) => s.name === match.sheetName) || workbook.sheets[0];
  const rows = sheet.rows;
  const total = rows.length;
  const columns = match.table1.columns.map((name) => {
    const header = sheet.headers.find((x) => x.name === name);
    if (isNumericColumn(header)) {
      const nums = [];
      let missing = 0;
      for (const r of rows) {
        const n = toNumber(r[name]);
        if (n == null) { missing++; continue; }
        nums.push(n);
      }
      const stats = computeNumericStats(nums);
      return { name, kind: "numeric", unit: inferColumnUnit(name), stats, missing };
    }
    const { entries, blank } = rankFrequency(rows, name);
    const levels = entries.slice().sort((a, b) => b.count - a.count);
    return { name, kind: "categorical", levels, missing: blank, denom: total - blank };
  });
  return { sheetName: sheet.name, total, columns };
}

// The flat display/result rows — one header row per column, one row per
// categorical level, a single summary row per numeric column. `Missing` is the
// per-column count of blank/unreadable cells, stated on every column's row.
export function table1ResultRows(exec) {
  const out = [];
  for (const col of exec.columns) {
    if (col.kind === "numeric") {
      out.push({
        Characteristic: col.name,
        Summary: numericSummaryText(col.stats, col.unit),
        Missing: col.missing,
      });
    } else {
      out.push({ Characteristic: `${col.name} — n (%)`, Summary: "", Missing: col.missing });
      for (const lvl of col.levels) {
        out.push({ Characteristic: `  ${lvl.label}`, Summary: formatNPercent(lvl.count, col.denom), Missing: "" });
      }
    }
  }
  return out;
}

// A plain-English version of the same table for the summary box.
export function buildTable1Summary(match, exec) {
  const lines = [match.lookedFor, ""];
  lines.push(`Table 1 over all ${exec.total} row${exec.total === 1 ? "" : "s"} in "${exec.sheetName}":`);
  for (const col of exec.columns) {
    lines.push("");
    if (col.kind === "numeric") {
      lines.push(`${col.name}: ${numericSummaryText(col.stats, col.unit)}. Missing: ${col.missing}.`);
    } else {
      lines.push(`${col.name} (missing ${col.missing}; out of ${col.denom} with a value):`);
      for (const lvl of col.levels) {
        lines.push(`  - ${lvl.label}: ${formatNPercent(lvl.count, col.denom)}.`);
      }
    }
  }
  lines.push("");
  lines.push("This was answered on your computer, with no data sent anywhere. Numerics are median (IQR) with mean (SD); categories are n (%) of the rows that had a value in that column.");
  return lines.join("\n");
}

// The column metadata the worker transform needs to rebuild the same table.
export function table1ColumnMeta(match, sheet) {
  return match.table1.columns.map((name) => {
    const header = sheet.headers.find((x) => x.name === name);
    return { name, numeric: isNumericColumn(header), unit: inferColumnUnit(name) || null };
  });
}

// A stable helper the worker transform inlines by reference (foldKey source).
export { foldKey };
