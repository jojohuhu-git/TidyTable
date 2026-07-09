// Shared cleaning functions (build prompt §6/§7). Each normalizer exists in two
// honest forms that MUST agree:
//   1. a pure JavaScript cell function, run inside the generated transform (and
//      unit-tested directly), and
//   2. an Excel helper-column recipe, so the steps the user follows by hand
//      match what the app did.
//
// The cell functions are deliberately self-contained (no module-scope refs, ES5
// style) so buildFixPlan can inline their exact source via Function.toString()
// into the Web Worker transform. Do not add closures or imports to them.

/* ---- 1. Numbers stored as text: " 5 ", "$1,200", "1,204" -> 5, 1200, 1204 ---- */
export function coerceNumbers(v) {
  if (typeof v !== "string") return v;
  var t = v.trim().replace(/[$,\s]/g, "");
  if (t === "") return v;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return v;
}

/* ---- 2. Sentinel blanks: N/A, n/a, none, -, . , "" -> null ---- */
export function sentinelBlanks(v) {
  if (v == null) return null;
  var t = String(v).trim().toLowerCase();
  if (t === "" || t === "n/a" || t === "na" || t === "none" || t === "-" || t === ".") return null;
  return v;
}

/* ---- 4. Text dates -> ISO. order: "MDY" (default) or "DMY". Validates the
   month/day/calendar before rewriting; an invalid or ambiguous-without-an-order
   value is left completely unchanged rather than guessed. ---- */
export function parseDates(v, order) {
  if (v == null) return v;
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return v;
  var a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10);
  var mo, d;
  if (order === "DMY") { d = a; mo = b; } else { mo = a; d = b; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return v;
  var daysInMonth = new Date(y, mo, 0).getDate();
  if (d > daysInMonth) return v;
  var moS = ("0" + mo).slice(-2);
  var dS = ("0" + d).slice(-2);
  return y + "-" + moS + "-" + dS;
}

/* ---- 9. Numbers Excel mis-typed as dates: a duration/measurement column where
   Excel auto-formatted some numeric cells as a date/time near its 1899-12-30
   epoch. Converts those cells back to the plain day-count integer they really
   are. Only strings shaped like an epoch-window ISO date (year 1899 or 1900,
   as produced by parseWorkbookFile's Date -> "YYYY-MM-DD" conversion) are
   touched; everything else, including genuine modern dates, is left alone. ---- */
export function epochSerialToNumber(v) {
  if (typeof v !== "string") return v;
  var m = v.match(/^(1899|1900)-(\d{2})-(\d{2})$/);
  if (!m) return v;
  var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  var epoch = Date.UTC(1899, 11, 30);
  var target = Date.UTC(y, mo - 1, d);
  return Math.round((target - epoch) / 86400000);
}

/* ---- 5. Category variants: map raw variant -> chosen canonical spelling ---- */
export function trimCase(v, map) {
  if (v == null) return v;
  var key = String(v);
  if (map && Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  return v;
}

// Fold a value to a comparison key so "West", "west ", "WEST" collapse together.
export function foldKey(v) {
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}

/* ---- 7. Censored lab values: "<0.5", ">1000", "pending" ---- */
// policy: "boundary" (use the number), "missing" (blank it), "exclude" (leave as-is).
export function censoredValues(v, policy) {
  if (v == null) return v;
  var s = String(v).trim();
  var m = s.match(/^([<>]=?)\s*(-?\d+(\.\d+)?)$/);
  if (m) {
    if (policy === "missing") return null;
    if (policy === "boundary") return Number(m[2]);
    return v; // exclude
  }
  if (/^(pending|tnp|not done|nd)$/i.test(s)) {
    return policy === "missing" ? null : v;
  }
  return v;
}

/* ---- 8. Multi-value cells: "red, blue" -> ["red","blue"] (row explode) ---- */
export function splitList(v) {
  if (v == null) return [null];
  var parts = String(v).split(/\s*[;,]\s*/).map(function (x) { return x.trim(); })
    .filter(function (x) { return x !== ""; });
  return parts.length ? parts : [null];
}

// Registry so buildFixPlan can look a normalizer up by id and inline its source.
export const NORMALIZERS = {
  coerceNumbers: { fn: coerceNumbers, needsParam: false },
  sentinelBlanks: { fn: sentinelBlanks, needsParam: false },
  parseDates: { fn: parseDates, needsParam: true },
  trimCase: { fn: trimCase, needsParam: true },
  censoredValues: { fn: censoredValues, needsParam: true },
  splitList: { fn: splitList, needsParam: false },
  epochSerialToNumber: { fn: epochSerialToNumber, needsParam: false },
};

// ---------------------------------------------------------------------------
// Excel helper-column recipes. Each returns PLAN_SCHEMA excel_steps entries that
// reproduce the same fix by hand: put a formula in a new helper column, fill it
// down, then use that column in place of the original.
// ctx = { sheetName, colName, letter, helperLetter, lastRow, params }
// ---------------------------------------------------------------------------

const fillRange = (ctx) => `${ctx.helperLetter}2:${ctx.helperLetter}${ctx.lastRow}`;
const firstCell = (ctx) => `${ctx.letter}2`;
const helperCell = (ctx) => `${ctx.helperLetter}2`;

export const EXCEL_STEPS = {
  coerceNumbers(ctx) {
    return [{
      title: `Turn text numbers in "${ctx.colName}" into real numbers`,
      where: `Sheet "${ctx.sheetName}", cell ${helperCell(ctx)}, then fill down to ${ctx.helperLetter}${ctx.lastRow}`,
      formula: `=IFERROR(VALUE(SUBSTITUTE(SUBSTITUTE(TRIM(${firstCell(ctx)}),"$",""),",","")),${firstCell(ctx)})`,
      instruction: `In a new column ${ctx.helperLetter}, this strips spaces, dollar signs, and commas and reads the result as a number. Use column ${ctx.helperLetter} in place of ${ctx.letter} from here on. Fill the formula down over range ${fillRange(ctx)}.`,
    }];
  },
  sentinelBlanks(ctx) {
    return [{
      title: `Blank out "not available" markers in "${ctx.colName}"`,
      where: `Sheet "${ctx.sheetName}", cell ${helperCell(ctx)}, then fill down to ${ctx.helperLetter}${ctx.lastRow}`,
      formula: `=IF(OR(TRIM(${firstCell(ctx)})="",LOWER(TRIM(${firstCell(ctx)}))="n/a",LOWER(TRIM(${firstCell(ctx)}))="na",LOWER(TRIM(${firstCell(ctx)}))="none",TRIM(${firstCell(ctx)})="-",TRIM(${firstCell(ctx)})="."),"",${firstCell(ctx)})`,
      instruction: `In a new column ${ctx.helperLetter}, this leaves a truly empty cell wherever ${ctx.letter} holds a stand-in for "no value", so counts and averages ignore them. Fill down over ${fillRange(ctx)}.`,
    }];
  },
  parseDates(ctx) {
    const order = ctx.params?.order || "MDY";
    const orderLabel = order === "DMY" ? "Day/Month/Year" : "Month/Day/Year";
    return [{
      title: `Standardize the dates in "${ctx.colName}"`,
      where: `Sheet "${ctx.sheetName}", cell ${helperCell(ctx)}, then fill down to ${ctx.helperLetter}${ctx.lastRow}`,
      formula: `=IFERROR(TEXT(DATEVALUE(${firstCell(ctx)}),"yyyy-mm-dd"),${firstCell(ctx)})`,
      instruction: `In a new column ${ctx.helperLetter}, this reads each date and writes it back in the single format YYYY-MM-DD so they sort and compare correctly. Fill down over ${fillRange(ctx)}. The app read this column as ${orderLabel} order. Excel's DATEVALUE instead follows your computer's regional date setting, not this column's own pattern — before trusting this column, check that your Windows/Mac Region (or Excel language) setting also expects ${orderLabel} order, otherwise DATEVALUE can silently read some of these dates differently from the app.`,
    }];
  },
  trimCase(ctx) {
    // params.map: { rawVariant: canonical }. Build a two-column lookup table the
    // user pastes, then look each value up.
    const pairs = Object.entries(ctx.params?.map || {});
    const fromRange = `$Y$2:$Y$${pairs.length + 1}`;
    const toRange = `$Z$2:$Z$${pairs.length + 1}`;
    const table = pairs.map(([from, to]) => `  ${from}  ->  ${to}`).join("\n");
    return [{
      title: `Merge the spellings in "${ctx.colName}"`,
      where: `Sheet "${ctx.sheetName}": in columns Y and Z put a small lookup table (each old spelling in Y, the chosen spelling in Z), then use cell ${helperCell(ctx)} and fill down to ${ctx.helperLetter}${ctx.lastRow}`,
      formula: `=IFERROR(XLOOKUP(${firstCell(ctx)},${fromRange},${toRange}),${firstCell(ctx)})`,
      instruction: `Paste this mapping into columns Y and Z:\n${table}\nThen column ${ctx.helperLetter} replaces each value in ${ctx.letter} with its chosen spelling (and leaves anything not listed unchanged). Fill down over ${fillRange(ctx)}. (Older Excel without XLOOKUP: use =IFERROR(VLOOKUP(${firstCell(ctx)},${fromRange.replace("$Y", "$Y").replace("$Z$", "$Z$")},1,FALSE),${firstCell(ctx)}) against a two-column table.)`,
    }];
  },
  censoredValues(ctx) {
    const policy = ctx.params?.policy || "boundary";
    if (policy === "missing") {
      return [{
        title: `Blank out "below/above limit" results in "${ctx.colName}"`,
        where: `Sheet "${ctx.sheetName}", cell ${helperCell(ctx)}, then fill down to ${ctx.helperLetter}${ctx.lastRow}`,
        formula: `=IF(ISNUMBER(VALUE(${firstCell(ctx)})),VALUE(${firstCell(ctx)}),"")`,
        instruction: `In a new column ${ctx.helperLetter}, this keeps plain numbers and leaves everything else (like "<0.5" or "pending") blank, so they are not counted as a value. Fill down over ${fillRange(ctx)}.`,
      }];
    }
    // boundary
    return [{
      title: `Use the limit number for "below/above limit" results in "${ctx.colName}"`,
      where: `Sheet "${ctx.sheetName}", cell ${helperCell(ctx)}, then fill down to ${ctx.helperLetter}${ctx.lastRow}`,
      formula: `=IFERROR(VALUE(${firstCell(ctx)}),VALUE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${firstCell(ctx)},"<",""),">",""),"=","")," ","")))`,
      instruction: `In a new column ${ctx.helperLetter}, this reads a plain number as-is, and for a result like "<0.5" it uses the limit number 0.5. Fill down over ${fillRange(ctx)}.`,
    }];
  },
  epochSerialToNumber(ctx) {
    return [{
      title: `Fix numbers Excel mis-typed as dates in "${ctx.colName}"`,
      where: `Sheet "${ctx.sheetName}", column ${ctx.letter}`,
      formula: "",
      instruction: `Some cells in "${ctx.colName}" were formatted as a date/time by Excel but are really plain numbers (this happens when a number like a day-count gets auto-formatted). The value stored is already correct — only the display format is wrong. Select the affected cells, then Format Cells > Number (or General), and they will show as plain numbers again. No formula needed.`,
    }];
  },
  splitList(ctx) {
    return [{
      title: `Split multi-value cells in "${ctx.colName}" into separate rows`,
      where: `Sheet "${ctx.sheetName}", column ${ctx.letter}`,
      formula: "",
      instruction: `Excel cannot split one row into several with a formula. Select column ${ctx.letter}, then use Data > Text to Columns with the comma as the separator to spread the values across columns; then rearrange so each value sits on its own row. The app has already done this for you in the result table — this step is only if you want to reproduce it by hand.`,
    }];
  },
};
