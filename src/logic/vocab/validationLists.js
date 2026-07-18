// P4-3: read Excel data-validation PICKLISTS straight out of an .xlsx file.
// The owner builds her columns from validation dropdowns, so the workbook
// itself already carries the full list of legal terms per column — in
// xl/worksheets/*.xml <dataValidation type="list"> entries. SheetJS Community
// Edition drops these on read, so this module opens the zip itself (zip.js)
// and parses the XML directly. Read-only; never guesses: a list it cannot
// resolve (e.g. an INDIRECT() formula) is skipped, not invented.
//
// Excel stores a list's terms three ways, all handled here:
//   1. inline           — <formula1>"cUTI,Pyelonephritis,Cystitis"</formula1>
//   2. cell range       — <formula1>Lists!$A$1:$A$5</formula1>
//   3. named range      — <formula1>WardList</formula1> (workbook definedNames)
// plus the x14 extLst variant older Excel used for cross-sheet lists.

import { zipEntries, readZipEntryText } from "./zip.js";

// A source range bigger than this is almost certainly not a hand-kept picklist
// — stop collecting rather than scan a whole column of 1M cells.
const MAX_TERMS_PER_LIST = 1000;

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : null;
}

// "AB" -> 27 (0-indexed 0 for "A" is handled by callers via colToIndex)
export function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToCol(i) {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Parse one A1-style range token ("B2:C50", "A2", "A:A", with optional $s).
// Returns { c1, c2, r1, r2 } (0-indexed columns, 1-indexed rows, rows null for
// whole-column refs) or null if it isn't a range.
function parseRange(token) {
  const m = String(token).trim().match(/^\$?([A-Z]+)\$?(\d+)?(?::\$?([A-Z]+)\$?(\d+)?)?$/i);
  if (!m) return null;
  const c1 = colToIndex(m[1]);
  const c2 = m[3] != null ? colToIndex(m[3]) : c1;
  const r1 = m[2] != null ? Number(m[2]) : null;
  const r2 = m[4] != null ? Number(m[4]) : r1;
  return { c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1, r2 };
}

// Split "Lists!$A$1:$A$5" / "'My Lists'!A1:A5" / "A1:A5" into sheet + range.
function parseSheetRange(ref) {
  const m = String(ref).trim().match(/^(?:'([^']+)'|([^'!]+))!(.+)$/);
  if (m) {
    const range = parseRange(m[3]);
    return range ? { sheetName: m[1] || m[2], range } : null;
  }
  const range = parseRange(ref);
  return range ? { sheetName: null, range } : null;
}

// Pull every <si> of sharedStrings.xml into an array (rich-text runs joined).
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const texts = [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeEntities(t[1]));
    out.push(texts.join(""));
  }
  return out;
}

// Build ref -> display value for every cell of one worksheet's XML.
function parseCells(xml, sharedStrings) {
  const cells = new Map();
  for (const m of xml.matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const tag = m[1] != null ? m[1] : m[2];
    const body = m[3] || "";
    const ref = attr(`<c ${tag}>`, "r");
    if (!ref) continue;
    const t = attr(`<c ${tag}>`, "t");
    let value = null;
    if (t === "inlineStr") {
      const texts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeEntities(x[1]));
      value = texts.join("");
    } else {
      const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      if (!v) continue;
      const raw = decodeEntities(v[1]);
      if (t === "s") value = sharedStrings[Number(raw)] ?? null;
      else if (t === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else value = raw; // t="str" formula text, or a plain number
    }
    if (value != null && String(value).trim() !== "") cells.set(ref.toUpperCase(), String(value));
  }
  return cells;
}

// Collect the <dataValidation type="list"> entries of one worksheet's XML —
// both the main-namespace form and the x14 extLst form. Returns
// [{ sqref, formula }] with XML entities decoded.
function listValidations(xml) {
  const out = [];
  for (const m of xml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)) {
    if (attr(`<dv ${m[1]}>`, "type") !== "list") continue;
    const sqref = attr(`<dv ${m[1]}>`, "sqref");
    const f = m[2].match(/<formula1\b[^>]*>([\s\S]*?)<\/formula1>/);
    if (sqref && f) out.push({ sqref, formula: decodeEntities(f[1]).trim() });
  }
  for (const m of xml.matchAll(/<x14:dataValidation\b([^>]*)>([\s\S]*?)<\/x14:dataValidation>/g)) {
    if (attr(`<dv ${m[1]}>`, "type") !== "list") continue;
    const f = m[2].match(/<x14:formula1\b[^>]*>\s*<xm:f\b[^>]*>([\s\S]*?)<\/xm:f>/);
    const sq = m[2].match(/<xm:sqref\b[^>]*>([\s\S]*?)<\/xm:sqref>/);
    if (f && sq) out.push({ sqref: decodeEntities(sq[1]).trim(), formula: decodeEntities(f[1]).trim() });
  }
  return out;
}

// Extract every column picklist in the workbook. Returns
// [{ sheetName, colLetter, terms: [string] }] — sheetName/colLetter say where
// the dropdown APPLIES (the data column), terms are the legal entries in their
// source order. Columns with lists we cannot resolve are simply absent.
export async function extractColumnVocabularies(buffer) {
  const entries = zipEntries(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = (name) => {
    const e = byName.get(name);
    return e ? readZipEntryText(buffer, e) : Promise.resolve(null);
  };

  const workbookXml = await read("xl/workbook.xml");
  if (!workbookXml) return [];

  // Sheet display names, in workbook order, with their relationship ids.
  const sheetDefs = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], "name");
    const rid = attr(m[0], "r:id");
    if (name && rid) sheetDefs.push({ name, rid });
  }

  const definedNames = new Map();
  for (const m of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const n = attr(`<dn ${m[1]}>`, "name");
    if (n) definedNames.set(n, decodeEntities(m[2]).trim());
  }

  // Relationship id -> zip path ("worksheets/sheet1.xml" is relative to xl/).
  const relsXml = (await read("xl/_rels/workbook.xml.rels")) || "";
  const relTargets = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attr(m[0], "Id");
    let target = attr(m[0], "Target");
    if (!id || !target) continue;
    target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    relTargets.set(id, target);
  }

  const sharedStrings = parseSharedStrings(await read("xl/sharedStrings.xml"));

  // Lazy caches: worksheet XML text and parsed cell maps, by sheet name.
  const xmlCache = new Map();
  async function sheetXml(sheetName) {
    if (!xmlCache.has(sheetName)) {
      const def = sheetDefs.find((s) => s.name === sheetName);
      const path = def && relTargets.get(def.rid);
      xmlCache.set(sheetName, path ? await read(path) : null);
    }
    return xmlCache.get(sheetName);
  }
  const cellCache = new Map();
  async function sheetCells(sheetName) {
    if (!cellCache.has(sheetName)) {
      const xml = await sheetXml(sheetName);
      cellCache.set(sheetName, xml ? parseCells(xml, sharedStrings) : null);
    }
    return cellCache.get(sheetName);
  }

  // Turn a formula1 into terms, or null when it can't be resolved honestly.
  async function resolveTerms(formula, ownSheetName) {
    const f = formula.trim();
    // 1. Inline list: a quoted, comma-separated string.
    if (/^".*"$/s.test(f)) {
      return f.slice(1, -1).split(",").map((t) => t.trim()).filter(Boolean);
    }
    // 2. Named range -> its recorded reference; 3. direct range reference.
    const ref = /^[A-Za-z_][\w.]*$/.test(f) ? definedNames.get(f) : f;
    if (!ref) return null;
    const parsed = parseSheetRange(ref);
    if (!parsed) return null;
    const cells = await sheetCells(parsed.sheetName || ownSheetName);
    if (!cells) return null;
    const { c1, c2, r1, r2 } = parsed.range;
    const rowStart = r1 ?? 1;
    const rowEnd = Math.min(r2 ?? 1048576, rowStart + MAX_TERMS_PER_LIST);
    const terms = [];
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = c1; c <= c2; c++) {
        const v = cells.get(`${indexToCol(c)}${r}`);
        if (v != null) terms.push(v);
        if (terms.length >= MAX_TERMS_PER_LIST) return terms;
      }
    }
    return terms;
  }

  const out = [];
  const seen = new Map(); // "sheet::col" -> terms array already emitted
  for (const def of sheetDefs) {
    const xml = await sheetXml(def.name);
    if (!xml) continue;
    for (const dv of listValidations(xml)) {
      const terms = await resolveTerms(dv.formula, def.name);
      if (!terms || !terms.length) continue;
      for (const token of String(dv.sqref).split(/\s+/)) {
        const range = parseRange(token);
        if (!range) continue;
        for (let c = range.c1; c <= range.c2; c++) {
          const col = indexToCol(c);
          const key = `${def.name}::${col}`;
          if (seen.has(key)) {
            // Two validations on one column: merge, keeping first-seen order.
            const existing = seen.get(key);
            for (const t of terms) if (!existing.includes(t)) existing.push(t);
          } else {
            const copy = [...terms];
            seen.set(key, copy);
            out.push({ sheetName: def.name, colLetter: col, terms: copy });
          }
        }
      }
    }
  }
  return out;
}
