// Checkup scan (build prompt §6). Deterministic, no AI. Given one sheet, return
// a list of findings: what was found, how many rows/cells it affects, a sample of
// the offending values, and (when we can fix it) which normalizer would do it.
// Nothing here changes data — fixes only run when the user picks them.

import { coerceNumbers, censoredValues, foldKey, splitList, isValidCalendarDate, dedupeEncounterRows } from "./normalizers.js";

const DATE_CANDIDATE = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;

const NEVER_NEGATIVE = /\b(age|count|qty|quantity|dose|amount|price|cost|weight|height|duration|days|mg|ml|number|num|total|score)\b/i;
const AGE_LIKE = /\bage\b/i;
const DATE_PAIRS = [
  [/(start|admit|admission|onset|begin|from)/i, /(end|discharge|resolve|resolved|stop|finish|to)/i],
];
const UNIT = /\b(kg|g|mg|mcg|ug|ml|l|lb|lbs|oz|cm|mm|in)\b/i;

let counter = 0;
const nextId = () => `f${++counter}`;

// Small helpers so counts read grammatically for one or many.
const s = (n) => (n === 1 ? "" : "s");
const be = (n) => (n === 1 ? "is" : "are");

function distinct(values) {
  return new Set(values).size;
}

function isNumericString(v) {
  return typeof v === "string" && typeof coerceNumbers(v) === "number";
}

function nonNull(rows, col) {
  return rows.map((r) => r[col]).filter((v) => v != null && String(v).trim() !== "");
}

function sample(values, n = 5) {
  const out = [];
  for (const v of values) {
    if (!out.includes(v)) out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

// --- individual detectors, each returns 0+ findings for one sheet ------------

function findDuplicateRows(sheet) {
  const seen = new Map();
  let dupes = 0;
  const exampleKeys = [];
  for (const row of sheet.rows) {
    const key = JSON.stringify(sheet.headers.map((h) => row[h.name]));
    const count = seen.get(key) || 0;
    if (count >= 1) {
      dupes++;
      if (exampleKeys.length < 3 && !exampleKeys.includes(key)) exampleKeys.push(key);
    }
    seen.set(key, count + 1);
  }
  if (dupes === 0) return [];
  return [{
    id: nextId(),
    type: "duplicateRows",
    sheet: sheet.name,
    column: null,
    title: "Duplicate rows",
    detail: `${dupes} row${dupes === 1 ? " is an exact copy" : "s are exact copies"} of an earlier row. Removing them keeps one of each.`,
    count: dupes,
    samples: exampleKeys.map((k) => JSON.parse(k).filter((x) => x != null).slice(0, 3).join(" · ")),
    fixable: true,
    fix: { normalizer: "dedupeRows" },
  }];
}

// Parked item 3a: real clinical report ID columns, recognized BY NAME, not by
// looks-unique statistics — a visits export where every patient has three rows
// is nowhere near 90% unique, so the generic detector below stays silent
// exactly when the recognition matters most. Tokenizes on separators and
// camelCase so "PAT_ENC_CSN_ID", "Encounter ID", and "PatientID" all resolve.
export function idColumnRole(name) {
  const tokens = String(name == null ? "" : name)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const joined = tokens.join(" ");
  const hasIdWord = /\b(id|ids|number|no|num)\b/.test(joined);
  if (tokens.includes("csn")) return "encounter";
  if (/\bencounter\b/.test(joined) && hasIdWord) return "encounter";
  if (tokens.includes("mrn")) return "patient";
  if (/\bmedical record\b/.test(joined)) return "patient";
  if (/\bpatient\b/.test(joined) && hasIdWord) return "patient";
  return null;
}

// Parked item 3b: duplicate ENCOUNTER IDs are a likely data error — each
// visit should appear once. Repeated rows that are exact copies can go with
// one click (keeping one of each); repeated IDs whose rows differ are shown
// side by side for the user to judge — the app never picks a winner.
function findDuplicateEncounterIds(sheet) {
  const out = [];
  const names = sheet.headers.map((x) => x.name);
  for (const h of sheet.headers) {
    if (idColumnRole(h.name) !== "encounter") continue;
    const counts = new Map();
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") continue;
      const k = String(v).trim();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const repeats = [...counts.entries()].filter(([, c]) => c > 1);
    if (!repeats.length) continue;
    const exactCopyCount = sheet.rows.length - dedupeEncounterRows(sheet.rows, names, h.name).length;
    // Groups whose rows do NOT fully match — capped preview for the card.
    const byId = new Map();
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") continue;
      const k = String(v).trim();
      if ((counts.get(k) || 0) < 2) continue;
      if (!byId.has(k)) byId.set(k, []);
      byId.get(k).push(r);
    }
    const differingGroups = [];
    for (const [id, rows] of byId) {
      const sigs = new Set(rows.map((r) => JSON.stringify(names.map((n) => r[n]))));
      if (sigs.size > 1) differingGroups.push({ id, rows: rows.slice(0, 4) });
      if (differingGroups.length >= 5) break;
    }
    const copyNote = exactCopyCount
      ? ` ${exactCopyCount} of the repeated rows ${be(exactCopyCount)} an exact copy of an earlier row — the fix removes ${exactCopyCount === 1 ? "it" : "them"}, keeping one of each.`
      : "";
    const differNote = differingGroups.length
      ? ` ${differingGroups.length} repeated ID${s(differingGroups.length)} ha${differingGroups.length === 1 ? "s" : "ve"} rows that do NOT fully match — compare them below and fix the right one in your file; the app will not pick a winner.`
      : "";
    out.push({
      id: nextId(),
      type: "duplicateEncounterIds",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Repeated encounter IDs in "${h.name}"`,
      detail: `"${h.name}" looks like an encounter (visit) ID, and each visit should normally appear once — but ${repeats.length} ID${s(repeats.length)} appear${repeats.length === 1 ? "s" : ""} more than once. That usually means the same visit was exported twice.${copyNote}${differNote}`,
      count: repeats.length,
      samples: sample(repeats.map(([v, c]) => `${v} (${c}×)`)),
      exactCopyCount,
      differingGroups,
      fixable: exactCopyCount > 0,
      fix: exactCopyCount > 0 ? { normalizer: "dedupeEncounters" } : null,
    });
  }
  return out;
}

// Parked item 3c: duplicate MRNs are often legitimate — one row per visit,
// not per patient. Nothing is flagged as wrong; the card explains, and offers
// an OPTIONAL collapse to one row per patient where the user chooses the
// surviving row. The app never decides which duplicate situation to clear.
function findDuplicatePatientIds(sheet) {
  const out = [];
  const names = sheet.headers.map((x) => x.name);
  for (const h of sheet.headers) {
    if (idColumnRole(h.name) !== "patient") continue;
    // Count patients with two or more genuinely DISTINCT rows. A patient
    // whose repeats are all exact copies is a duplicated export, not
    // "multiple visits" — that case belongs to the duplicate-rows finding,
    // and double-flagging it would make "remove the duplicates" ambiguous.
    const sigsById = new Map();
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") continue;
      const k = String(v).trim();
      if (!sigsById.has(k)) sigsById.set(k, new Set());
      sigsById.get(k).add(JSON.stringify(names.map((n) => r[n])));
    }
    const repeats = [...sigsById.entries()]
      .filter(([, sigs]) => sigs.size > 1)
      .map(([v, sigs]) => [v, sigs.size]);
    if (!repeats.length) continue;
    // Surviving-row choices: by each date-like column (capped at 3 so the
    // question stays readable), by sheet order when there is none, and always
    // "most complete".
    const dateCols = sheet.headers
      .filter((x) => x.type === "date" || /date/i.test(x.name))
      .map((x) => x.name)
      .slice(0, 3);
    const policyOptions = [];
    for (const d of dateCols) {
      policyOptions.push({ value: `first::${d}`, label: `Keep each patient's earliest row by "${d}"`, detail: "a row with no date loses to a row with one" });
      policyOptions.push({ value: `last::${d}`, label: `Keep each patient's most recent row by "${d}"`, detail: "a row with no date loses to a row with one" });
    }
    if (!dateCols.length) {
      policyOptions.push({ value: "firstrow", label: "Keep each patient's first row in the sheet", detail: "sheet order decides" });
      policyOptions.push({ value: "lastrow", label: "Keep each patient's last row in the sheet", detail: "sheet order decides" });
    }
    policyOptions.push({ value: "complete", label: "Keep each patient's most complete row", detail: "the row with the fewest empty cells" });
    out.push({
      id: nextId(),
      type: "duplicatePatientIds",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `The same patient appears on several rows ("${h.name}")`,
      detail: `${repeats.length} patient${s(repeats.length)} in "${h.name}" appear${repeats.length === 1 ? "s" : ""} on more than one row. That is often legitimate — a visits export has one row per visit, so a patient with multiple visits repeats. If that's what this file is, nothing needs fixing. If you want ONE row per patient instead, tick this fix and choose which row survives; removed rows stay listed in the result and the apply can be undone.`,
      count: repeats.length,
      samples: sample(repeats.map(([v, c]) => `${v} (${c}×)`)),
      fixable: true,
      fix: {
        normalizer: "keepOnePerPatient",
        needsPolicy: true,
        paramKey: "policy",
        policyQuestion: `Which row should survive for each patient in "${h.name}"?`,
        policyOptions,
      },
    });
  }
  return out;
}

function findDuplicateIds(sheet) {
  const out = [];
  for (const h of sheet.headers) {
    // Parked item 3a: name-recognized ID columns get their own, richer
    // findings above — don't double-flag them with the generic card.
    if (idColumnRole(h.name)) continue;
    const vals = nonNull(sheet.rows, h.name);
    if (vals.length < 4) continue;
    const d = distinct(vals);
    // "ID-like" = almost all values are unique.
    if (d / vals.length < 0.9) continue;
    const counts = new Map();
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
    const repeats = [...counts.entries()].filter(([, c]) => c > 1);
    if (repeats.length === 0) continue;
    out.push({
      id: nextId(),
      type: "duplicateIds",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Repeated values in the ID-like column "${h.name}"`,
      detail: `"${h.name}" looks like an identifier (almost every value is unique), but ${repeats.length} value${s(repeats.length)} appear${repeats.length === 1 ? "s" : ""} more than once. That often means duplicated or mismatched records.`,
      count: repeats.length,
      samples: sample(repeats.map(([v, c]) => `${v} (${c}×)`)),
      fixable: false,
      fix: null,
    });
  }
  return out;
}

// NEW-8: a sentinel-shaped token ("N/A") is not always missing data — a
// Sensitive/Resistant/N/A or "</= 10"/"> 10"/"N/A" field uses it as its own
// real category ("not tested"), and blanking it would erase that signal.
// Treat it as a category, not a blank, only when the column's OTHER values
// form a small closed set of real text labels (not numbers/durations, which
// legitimately have few distinct values in a small sheet purely by chance).
const CATEGORICAL_MAX_DISTINCT = 4;
function looksLikeClosedCategory(nonSentinelRaw) {
  if (nonSentinelRaw.length === 0) return false;
  const distinctCount = distinct(nonSentinelRaw.map((v) => v.toLowerCase()));
  if (distinctCount === 0 || distinctCount > CATEGORICAL_MAX_DISTINCT) return false;
  return !nonSentinelRaw.every((v) => typeof coerceNumbers(v) === "number");
}

function findMissing(sheet) {
  const out = [];
  const SENTINELS = new Set(["n/a", "na", "none", "-", "."]);
  for (const h of sheet.headers) {
    let blankCount = 0;
    let sentinelCount = 0;
    const sentinelForms = new Set();
    const nonSentinelRaw = [];
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") { blankCount++; continue; }
      const raw = String(v).trim();
      if (SENTINELS.has(raw.toLowerCase())) { sentinelCount++; sentinelForms.add(raw); }
      else { nonSentinelRaw.push(raw); }
    }
    const treatSentinelsAsMissing = !looksLikeClosedCategory(nonSentinelRaw);
    const missing = blankCount + (treatSentinelsAsMissing ? sentinelCount : 0);
    if (missing === 0) continue;
    const hasSentinels = treatSentinelsAsMissing && sentinelForms.size > 0;
    out.push({
      id: nextId(),
      type: "missing",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Missing values in "${h.name}"`,
      detail: hasSentinels
        ? `${missing} of ${sheet.rows.length} rows have no real value in "${h.name}", including stand-ins like ${[...sentinelForms].map((s) => `"${s}"`).join(", ")}. The fix turns these into truly empty cells so they are not mistaken for data.`
        : `${missing} of ${sheet.rows.length} rows are empty in "${h.name}". Nothing to fix automatically — just be aware when you count or average this column.`,
      count: missing,
      samples: hasSentinels ? [...sentinelForms] : [],
      fixable: hasSentinels,
      fix: hasSentinels ? { normalizer: "sentinelBlanks" } : null,
    });
  }
  return out;
}

function findTextNumbers(sheet) {
  const out = [];
  for (const h of sheet.headers) {
    if (h.type === "number" || h.type === "date") continue;
    const affected = [];
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (isNumericString(v) && /[\s$,]/.test(v)) affected.push(v);
      else if (isNumericString(v) && h.type === "mixed (text + numbers)") affected.push(v);
    }
    if (affected.length === 0) continue;
    out.push({
      id: nextId(),
      type: "textNumbers",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Numbers stored as text in "${h.name}"`,
      detail: `${affected.length} value${s(affected.length)} in "${h.name}" ${be(affected.length)} written as text (with spaces, "$", or commas), so Excel and R will not add or average them correctly. The fix reads them as plain numbers.`,
      count: affected.length,
      samples: sample(affected),
      fixable: true,
      fix: { normalizer: "coerceNumbers" },
    });
  }
  return out;
}

function findTextDates(sheet) {
  const out = [];
  for (const h of sheet.headers) {
    if (h.type === "number") continue;
    const candidates = [];
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null) continue;
      const str = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(str)) continue; // already ISO, nothing to do
      const m = str.match(DATE_CANDIDATE);
      if (m) candidates.push({ raw: v, a: parseInt(m[1], 10), b: parseInt(m[2], 10), y: parseInt(m[3], 10) });
    }
    if (candidates.length === 0) continue;

    // Decide the column's date order: a first number > 12 can only be a day
    // (forces D/M/Y); a second number > 12 can only be a day (forces M/D/Y).
    // If neither is forced, or both are forced by different values, the column
    // is genuinely ambiguous and must not be silently guessed.
    const forcesDMY = candidates.some((c) => c.a > 12);
    const forcesMDY = candidates.some((c) => c.b > 12);
    const ambiguous = forcesDMY === forcesMDY; // both true (conflict) or both false (all <=12)
    const order = ambiguous ? "MDY" : (forcesDMY ? "DMY" : "MDY");

    const valid = candidates.filter((c) => {
      const mo = order === "DMY" ? c.b : c.a;
      const d = order === "DMY" ? c.a : c.b;
      return isValidCalendarDate(c.y, mo, d);
    });
    const invalidCount = candidates.length - valid.length;
    if (valid.length === 0) continue; // nothing this fix would actually change

    const orderLabel = order === "DMY" ? "day/month/year" : "month/day/year";
    const unreadableNote = invalidCount
      ? ` ${invalidCount} value${s(invalidCount)} could not be read as a valid date and will be left unchanged.`
      : "";

    out.push({
      id: nextId(),
      type: "textDates",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Dates in a mixed or text format in "${h.name}"`,
      detail: ambiguous
        ? `${valid.length} date${s(valid.length)} in "${h.name}" ${be(valid.length)} written in a day/month/year style, but every value could be read either as Month/Day/Year or Day/Month/Year (e.g. "03/04/2024") — the app will not guess which, so it asks you first.${unreadableNote}`
        : `${valid.length} date${s(valid.length)} in "${h.name}" ${be(valid.length)} written in a ${orderLabel} style rather than a single sortable format. The fix rewrites them as YYYY-MM-DD so they sort and compare correctly.${unreadableNote}`,
      count: valid.length,
      samples: sample(valid.map((c) => c.raw)),
      fixable: true,
      fix: ambiguous
        ? {
          normalizer: "parseDates",
          needsPolicy: true,
          paramKey: "order",
          policyQuestion: `Are the dates in "${h.name}" written as Month/Day/Year or Day/Month/Year?`,
          policyOptions: [
            { value: "MDY", label: "Month/Day/Year", detail: "e.g. 03/04/2024 = March 4" },
            { value: "DMY", label: "Day/Month/Year", detail: "e.g. 03/04/2024 = April 3" },
          ],
        }
        : { normalizer: "parseDates", params: { order } },
    });
  }
  return out;
}

// NEW-1: a duration/measurement column where Excel auto-formatted a minority of
// cells as a date/time near its 1899-12-30 epoch, so parseWorkbookFile's
// Date -> "YYYY-MM-DD" conversion turned plain numbers into fake 1899/1900
// dates. Only fires when the rest of the column is genuinely numeric, so a real
// date column (or a column with real 1899/1900-era dates, which clinical data
// never has) is not mistaken for this pattern.
function findEpochDates(sheet) {
  const out = [];
  for (const h of sheet.headers) {
    if (h.type === "number" || h.type === "date") continue;
    let numericCount = 0;
    const epochCells = [];
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null) continue;
      if (typeof v === "number") { numericCount++; continue; }
      if (typeof v === "string") {
        const m = v.match(/^(1899|1900)-\d{2}-\d{2}$/);
        if (m) epochCells.push(v);
      }
    }
    if (epochCells.length === 0 || numericCount === 0 || numericCount < epochCells.length) continue;
    out.push({
      id: nextId(),
      type: "epochDates",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Numbers that Excel accidentally turned into dates in "${h.name}"`,
      detail: `Excel auto-formatted ${epochCells.length} plain number${s(epochCells.length)} in "${h.name}" as a date by mistake. (In technical terms: ${epochCells.length} value${s(epochCells.length)} ${be(epochCells.length)} stored as dates from 1899-1900, Excel's internal date epoch, even though the rest of the column is plain numbers.) The fix converts these cells back to the plain number they represent — it never writes a 1899/1900 date into your data.`,
      count: epochCells.length,
      samples: sample(epochCells),
      fixable: true,
      fix: { normalizer: "epochSerialToNumber" },
    });
  }
  return out;
}

// NEW-2: a duration-like column where most text values are a number followed
// by a consistent unit word ("5 Days"). Offered as its own cleaning fix so the
// exported/cleaned data holds plain numbers; genuinely non-numeric text like
// "N/A" is left untouched.
function findUnitSuffixNumbers(sheet) {
  const out = [];
  for (const h of sheet.headers) {
    if (h.type === "number" || h.type === "date") continue;
    const matches = [];
    const units = new Map();
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (typeof v !== "string") continue;
      const m = v.trim().match(/^(-?\d+(?:\.\d+)?)\s+([A-Za-z]+)\.?$/);
      if (m) { matches.push(v); const u = m[2].toLowerCase(); units.set(u, (units.get(u) || 0) + 1); }
    }
    if (matches.length < 2) continue;
    const [dominantUnit, dominantCount] = [...units.entries()].sort((a, b) => b[1] - a[1])[0];
    if (dominantCount / matches.length < 0.6) continue; // not a consistent unit word
    out.push({
      id: nextId(),
      type: "unitSuffixNumbers",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Numbers written with a unit word in "${h.name}"`,
      detail: `${matches.length} value${s(matches.length)} in "${h.name}" ${be(matches.length)} written as a number followed by a word like "${dominantUnit}" (for example "5 ${dominantUnit}"). The fix reads just the number, so it can be added, averaged, or compared. Anything that isn't a number-plus-word, like "N/A", is left as-is.`,
      count: matches.length,
      samples: sample(matches),
      fixable: true,
      fix: { normalizer: "stripUnitSuffix" },
    });
  }
  return out;
}

function findCategoryVariants(sheet) {
  const out = [];
  for (const h of sheet.headers) {
    if (h.type === "number" || h.type === "date") continue;
    const vals = nonNull(sheet.rows, h.name).map(String);
    if (vals.length === 0) continue;
    const d = distinct(vals);
    // Only category-like columns (a small number of distinct values). Free-text
    // columns have many distinct values and are skipped; ID columns are unique
    // and produce no fold-collisions below, so they fall out naturally.
    if (d > 40) continue;
    const groups = new Map(); // foldKey -> Map(raw -> count)
    for (const v of vals) {
      const k = foldKey(v);
      if (!groups.has(k)) groups.set(k, new Map());
      const g = groups.get(k);
      g.set(v, (g.get(v) || 0) + 1);
    }
    const map = {};
    const merges = [];
    // A6: expose each fold-group's full spelling list (not just the map to
    // the default canonical), so the UI can let the user pick which
    // spelling survives instead of always defaulting to the most common one.
    const variantGroups = [];
    for (const g of groups.values()) {
      if (g.size <= 1) continue;
      const entries = [...g.entries()].sort((a, b) => b[1] - a[1]); // most common first
      const canonical = entries[0][0]; // default: the most common raw spelling
      for (const [raw] of entries) {
        if (raw !== canonical) { map[raw] = canonical; merges.push(`"${raw}" -> "${canonical}"`); }
      }
      variantGroups.push({ canonical, variants: entries.map(([value, count]) => ({ value, count })) });
    }
    if (merges.length === 0) continue;
    out.push({
      id: nextId(),
      type: "categoryVariants",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Different spellings of the same category in "${h.name}"`,
      detail: `Some values in "${h.name}" are the same category typed differently (upper/lower case or extra spaces). The fix merges each into one chosen spelling, so they group and count together.`,
      count: merges.length,
      samples: sample(merges),
      groups: variantGroups,
      fixable: true,
      fix: { normalizer: "trimCase", params: { map } },
    });
  }
  return out;
}

function findImpossible(sheet) {
  const out = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const h of sheet.headers) {
    // Negative in a never-negative column.
    if (NEVER_NEGATIVE.test(h.name)) {
      const neg = sheet.rows.map((r) => r[h.name]).filter((v) => typeof v === "number" && v < 0);
      if (neg.length) out.push(flag(sheet, h, "impossible", `Negative values in "${h.name}"`,
        `${neg.length} row${neg.length === 1 ? " has a negative value" : "s have negative values"} in "${h.name}", which should never be below zero. Check these rows.`, sample(neg)));
    }
    // Age over 120.
    if (AGE_LIKE.test(h.name)) {
      const big = sheet.rows.map((r) => r[h.name]).filter((v) => typeof v === "number" && v > 120);
      if (big.length) out.push(flag(sheet, h, "impossible", `Ages over 120 in "${h.name}"`,
        `${big.length} value${big.length === 1 ? " is" : "s are"} above 120 in "${h.name}". These are likely typos or a different unit.`, sample(big)));
    }
    // Future dates.
    if (h.type === "date") {
      const future = sheet.rows.map((r) => r[h.name]).filter((v) => typeof v === "string" && v.slice(0, 10) > today);
      if (future.length) out.push(flag(sheet, h, "impossible", `Dates in the future in "${h.name}"`,
        `${future.length} date${future.length === 1 ? " is" : "s are"} after today in "${h.name}". Check for typos in the year.`, sample(future)));
    }
  }
  // Paired date columns where end is before start.
  const dateCols = sheet.headers.filter((h) => h.type === "date");
  for (const [startRe, endRe] of DATE_PAIRS) {
    const s = dateCols.find((h) => startRe.test(h.name));
    const e = dateCols.find((h) => endRe.test(h.name));
    if (s && e && s.name !== e.name) {
      const bad = sheet.rows.filter((r) => typeof r[s.name] === "string" && typeof r[e.name] === "string" && r[e.name] < r[s.name]);
      if (bad.length) out.push({
        id: nextId(), type: "impossible", sheet: sheet.name, column: e.name, letter: e.letter,
        title: `"${e.name}" is before "${s.name}"`,
        detail: `${bad.length} row${bad.length === 1 ? " has" : "s have"} "${e.name}" earlier than "${s.name}", which is impossible for a start/end pair. Check these rows.`,
        count: bad.length, samples: bad.slice(0, 5).map((r) => `${r[s.name]} -> ${r[e.name]}`), fixable: false, fix: null,
      });
    }
  }
  return out;
}

function flag(sheet, h, type, title, detail, samples) {
  return {
    id: nextId(), type, sheet: sheet.name, column: h.name, letter: h.letter,
    title, detail, count: samples.length, samples, fixable: false, fix: null,
  };
}

// NEW-8: "</= 10" is real clinical shorthand for "≤ 10" (a WBCs-style lab
// column reports every result as a threshold, never a raw number) — the
// plain "<=" form is already covered by [<>]=?, this adds the "</=" and
// ">/=" spellings seen in real sheets.
const CENSOR_RE = /^(?:[<>]=?|<\/=|>\/=)\s*-?\d/;
const CENSOR_SENTINEL_RE = /^(n\/a|na|none|-|\.)$/i;

function findCensored(sheet) {
  const out = [];
  for (const h of sheet.headers) {
    if (h.type === "date") continue;
    const affected = [];
    let plainNumbers = 0;
    let otherText = 0;
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null) continue;
      if (typeof v === "number") { plainNumbers++; continue; }
      const s = String(v).trim();
      if (s === "") continue;
      if (CENSOR_RE.test(s) || /^(pending|tnp|not done|nd)$/i.test(s)) { affected.push(v); continue; }
      if (isNumericString(v)) { plainNumbers++; continue; }
      if (CENSOR_SENTINEL_RE.test(s)) continue; // a missing-value marker, not evidence either way
      otherText++;
    }
    // Surface either where the column is mostly numeric (a real measurement
    // column with a few censored results), or where every recognized value
    // is a censored/threshold result (a column reported entirely as
    // "<=X"/">X", with no unrelated free text) — a fully-censored lab column
    // like WBCs never has "plain numbers" at all.
    const passesNumericMajority = plainNumbers >= affected.length;
    const passesAllRecognized = otherText === 0;
    if (affected.length === 0 || !(passesNumericMajority || passesAllRecognized)) continue;
    out.push({
      id: nextId(),
      type: "censored",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Below/above-limit results in "${h.name}"`,
      detail: `${affected.length} value${s(affected.length)} in "${h.name}" ${be(affected.length)} limit results like "<0.5" or ">1000", or notes like "pending". How these should count is a judgment call, so the fix will ask you first.`,
      count: affected.length,
      samples: sample(affected),
      fixable: true,
      fix: { normalizer: "censoredValues", needsPolicy: true },
    });
  }
  return out;
}

function findMultiValue(sheet) {
  const out = [];
  for (const h of sheet.headers) {
    if (h.type === "number" || h.type === "date") continue;
    const affected = [];
    let lenSum = 0, lenN = 0;
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null) continue;
      lenSum += String(v).length; lenN++;
      if (splitList(v).length > 1) affected.push(v);
    }
    const avgLen = lenN ? lenSum / lenN : 0;
    // Avoid free-text/notes columns: only short-ish list-like cells.
    if (affected.length < 2 || avgLen > 40) continue;
    out.push({
      id: nextId(),
      type: "multiValue",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Several values packed into one cell in "${h.name}"`,
      detail: `${affected.length} cell${s(affected.length)} in "${h.name}" hold${affected.length === 1 ? "s" : ""} more than one value separated by commas. If you group or count by this column, the fix can split them so each value is counted on its own row.`,
      count: affected.length,
      samples: sample(affected),
      fixable: true,
      fix: { normalizer: "splitList" },
    });
  }
  return out;
}

function findMixedUnits(sheet) {
  const out = [];
  for (const h of sheet.headers) {
    if (h.type === "number" || h.type === "date") continue;
    const units = new Set();
    const affected = [];
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null) continue;
      const m = String(v).match(UNIT);
      if (m && /\d/.test(String(v))) { units.add(m[1].toLowerCase()); affected.push(v); }
    }
    if (units.size < 2) continue;
    out.push({
      id: nextId(),
      type: "mixedUnits",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Mixed units in "${h.name}"`,
      detail: `"${h.name}" mixes different units (${[...units].join(", ")}). This needs a person to decide how to convert them — the app will not change it automatically. Use the AI mode, or standardize the units by hand.`,
      count: affected.length,
      samples: sample(affected),
      fixable: false,
      fix: null,
    });
  }
  return out;
}

// P4-3: cells that are NOT on their column's Excel dropdown list. The picklist
// terms arrive on sheet.vocab (read from the file's data-validation entries at
// upload). Excel only enforces the dropdown on typed entries — pasted or
// imported values bypass it — so an off-list value is usually a typo or a
// hand-typed variant no other detector can catch (only the list knows the
// legal spellings). Warn-only: the app can't know which legal term was meant,
// so it never picks one.
function findNotInPicklist(sheet) {
  const out = [];
  const vocab = sheet.vocab || {};
  for (const h of sheet.headers) {
    const terms = vocab[h.name];
    if (!terms || !terms.length) continue;
    // Compare folded (trimmed, lowercased) so pure case/spacing variants —
    // already covered by their own fixable findings — aren't double-flagged.
    const allowed = new Set(terms.map(foldKey));
    const offenders = nonNull(sheet.rows, h.name).filter((v) => !allowed.has(foldKey(v)));
    if (!offenders.length) continue;
    out.push({
      id: nextId(),
      type: "notInPicklist",
      sheet: sheet.name,
      column: h.name,
      letter: h.letter,
      title: `Values not on the "${h.name}" dropdown list`,
      detail: `In Excel, "${h.name}" is filled from a dropdown list of ${terms.length} allowed entr${terms.length === 1 ? "y" : "ies"}, but ${offenders.length} cell${s(offenders.length)} hold${offenders.length === 1 ? "s" : ""} a value that isn't on that list — usually a typo, or something pasted or typed by hand. Fix them in Excel (or leave them if they're intentional); the app won't guess which list entry was meant.`,
      count: offenders.length,
      samples: sample(offenders),
      fixable: false,
      fix: null,
    });
  }
  return out;
}

// Run every detector against one sheet.
export function checkupSheet(sheet) {
  counter = 0;
  return [
    ...findDuplicateRows(sheet),
    ...findDuplicateEncounterIds(sheet),
    ...findDuplicatePatientIds(sheet),
    ...findDuplicateIds(sheet),
    ...findNotInPicklist(sheet),
    ...findMissing(sheet),
    ...findTextNumbers(sheet),
    ...findTextDates(sheet),
    ...findEpochDates(sheet),
    ...findUnitSuffixNumbers(sheet),
    ...findCategoryVariants(sheet),
    ...findImpossible(sheet),
    ...findCensored(sheet),
    ...findMultiValue(sheet),
    ...findMixedUnits(sheet),
  ];
}

// P4-4: scan every sheet in the workbook, not just the first, and return one
// combined list. Each finding already carries `sheet: sheet.name` (set by the
// individual detectors above); checkupSheet resets its own id counter on
// every call, so ids alone would collide across sheets (both could produce
// "f1") — prefix by sheet index to keep every id globally unique.
export function checkupWorkbook(sheets) {
  return sheets.flatMap((sheet, i) => checkupSheet(sheet).map((f) => ({ ...f, id: `s${i}-${f.id}` })));
}
