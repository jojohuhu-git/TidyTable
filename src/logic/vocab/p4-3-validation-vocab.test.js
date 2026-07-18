import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { zipEntries, readZipEntryText } from "./zip.js";
import { extractColumnVocabularies } from "./validationLists.js";
import { parseWorkbookFile, deriveSheet } from "../workbook.js";
import { matchRequest } from "../offline/matcher.js";
import { runOffline } from "../offline/runOffline.js";
import { nearestSuggestions } from "../offline/valueMatch.js";
import { checkupSheet } from "../checkup/scan.js";

// P4-3: the owner's columns are built FROM Excel validation dropdowns — the
// workbook itself carries the full list of legal terms per column, in
// xl/worksheets/*.xml <dataValidation> entries that SheetJS CE never surfaces.
// These tests build a real (CRC-valid, Excel-shaped) .xlsx in memory, then
// prove: (1) the zip/XML extraction reads every list flavor Excel writes,
// (2) parseWorkbookFile attaches the terms to the right columns as
// sheet.vocab, (3) Step 3 recognizes a list term no row contains yet, and
// (4) Step 2 flags cells that are NOT on their column's list.

// ---------------------------------------------------------------------------
// Fixture: a tiny zip writer (stored or deflated entries, real CRC-32) so the
// fixture is a genuine zip that both our reader and SheetJS can open.
// Test-only — the app never writes zips this way.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(files, { deflate = false } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (b) => { chunks.push(b); offset += b.length; };
  const u16 = (v) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
  const cat = (...parts) => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  for (const { name, text } of files) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
    const packed = deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const method = deflate ? 8 : 0;
    const crc = crc32(data);
    const localOffset = offset;
    push(cat(
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(crc), u32(packed.length), u32(data.length), u16(nameB.length), u16(0),
      nameB, packed,
    ));
    central.push(cat(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(crc), u32(packed.length), u32(data.length), u16(nameB.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(localOffset), nameB,
    ));
  }
  const cdStart = offset;
  for (const c of central) push(c);
  const cdSize = offset - cdStart;
  push(cat(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cdSize), u32(cdStart), u16(0),
  ));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

// The canonical fixture workbook: sheet "Data" whose columns carry every list
// flavor Excel writes, and sheet "Lists" holding the source cells.
//   Data!A Diagnosis — inline list "cUTI,Pyelonephritis,Cystitis"
//   Data!B Drug      — range list Lists!$A$1:$A$5 (shared strings, an XML
//                      entity, an inlineStr, a numeric cell, one empty cell)
//   Data!C Ward      — named range WardList -> Lists!$C$1:$C$2
//   Data!D Source    — x14 extLst validation -> Lists!$B$1:$B$2
//   Data!E/F Extra   — one validation spanning two columns (sqref "E2 F2")
//   Data!G Score     — a NON-list validation (type="whole") that must be ignored
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="Data" sheetId="1" r:id="rId1"/>
<sheet name="Lists" sheetId="2" r:id="rId2"/>
</sheets>
<definedNames><definedName name="WardList">Lists!$C$1:$C$2</definedName></definedNames>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

// Shared strings: 0=Amoxicillin, 1="Ceftriaxone & Co" (entity), 2=Urine, 3=Blood
const SHARED_STRINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
<si><t>Amoxicillin</t></si>
<si><t>Ceftriaxone &amp; Co</t></si>
<si><t>Urine</t></si>
<si><t>Blood</t></si>
</sst>`;

const cellIs = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

// Data sheet: header row + 2 data rows (inline strings so SheetJS reads them
// without consulting sharedStrings), plus the dataValidations under test.
const SHEET1_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:G3"/>
<sheetData>
<row r="1">${cellIs("A1", "Diagnosis")}${cellIs("B1", "Drug")}${cellIs("C1", "Ward")}${cellIs("D1", "Source")}${cellIs("E1", "Extra1")}${cellIs("F1", "Extra2")}${cellIs("G1", "Score")}</row>
<row r="2">${cellIs("A2", "Cystitis")}${cellIs("B2", "Amoxicillin")}${cellIs("C2", "ICU")}${cellIs("D2", "Urine")}${cellIs("E2", "Yes")}${cellIs("F2", "No")}<c r="G2"><v>5</v></c></row>
<row r="3">${cellIs("A3", "Pyelonefritis")}${cellIs("B3", "Amoxicillin")}${cellIs("C3", "General")}${cellIs("D3", "Blood")}${cellIs("E3", "Yes")}${cellIs("F3", "No")}<c r="G3"><v>7</v></c></row>
</sheetData>
<dataValidations count="4">
<dataValidation type="list" allowBlank="1" sqref="A2:A100"><formula1>"cUTI,Pyelonephritis,Cystitis"</formula1></dataValidation>
<dataValidation type="list" allowBlank="1" sqref="B2:B100"><formula1>Lists!$A$1:$A$5</formula1></dataValidation>
<dataValidation type="list" allowBlank="1" sqref="C2:C100"><formula1>WardList</formula1></dataValidation>
<dataValidation type="whole" operator="between" sqref="G2:G100"><formula1>1</formula1><formula2>10</formula2></dataValidation>
<dataValidation type="list" allowBlank="1" sqref="E2:E50 F2:F50"><formula1>"Yes,No"</formula1></dataValidation>
</dataValidations>
<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
<x14:dataValidations xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" count="1">
<x14:dataValidation type="list" allowBlank="1"><x14:formula1><xm:f>Lists!$B$1:$B$2</xm:f></x14:formula1><xm:sqref>D2:D100</xm:sqref></x14:dataValidation>
</x14:dataValidations></ext></extLst>
</worksheet>`;

// Lists sheet: A1/A2 shared strings, A3 inlineStr, A4 numeric, A5 left absent.
const SHEET2_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:C4"/>
<sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c>${cellIs("C1", "ICU")}</row>
<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>3</v></c>${cellIs("C2", "General")}</row>
<row r="3">${cellIs("A3", "Nitrofurantoin")}</row>
<row r="4"><c r="A4"><v>500</v></c></row>
</sheetData>
</worksheet>`;

function fixtureFiles() {
  return [
    { name: "[Content_Types].xml", text: CONTENT_TYPES },
    { name: "_rels/.rels", text: ROOT_RELS },
    { name: "xl/workbook.xml", text: WORKBOOK_XML },
    { name: "xl/_rels/workbook.xml.rels", text: WORKBOOK_RELS },
    { name: "xl/sharedStrings.xml", text: SHARED_STRINGS },
    { name: "xl/worksheets/sheet1.xml", text: SHEET1_XML },
    { name: "xl/worksheets/sheet2.xml", text: SHEET2_XML },
  ];
}

const fixtureBuffer = (opts) => buildZip(fixtureFiles(), opts);

// A stub with the three properties parseWorkbookFile reads off a File.
function stubFile(buffer, name = "picklists.xlsx") {
  return { name, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", arrayBuffer: async () => buffer, text: async () => { throw new Error("not text"); } };
}

// ---------------------------------------------------------------------------
describe("P4-3 zip reader", () => {
  it("lists entries and reads stored (uncompressed) text", async () => {
    const buf = fixtureBuffer();
    const entries = zipEntries(buf);
    expect(entries.map((e) => e.name)).toContain("xl/workbook.xml");
    const wb = entries.find((e) => e.name === "xl/workbook.xml");
    const text = await readZipEntryText(buf, wb);
    expect(text).toContain('name="Data"');
  });

  it("reads deflate-compressed entries (the way real Excel files are written)", async () => {
    const buf = fixtureBuffer({ deflate: true });
    const entries = zipEntries(buf);
    const ws = entries.find((e) => e.name === "xl/worksheets/sheet1.xml");
    expect(ws.method).toBe(8);
    const text = await readZipEntryText(buf, ws);
    expect(text).toContain("dataValidation");
  });

  it("throws a plain-English error on a non-zip buffer", () => {
    expect(() => zipEntries(new TextEncoder().encode("not a zip at all").buffer)).toThrow(/zip/i);
  });
});

describe("P4-3 validation-list extraction", () => {
  it.each([["stored", {}], ["deflated", { deflate: true }]])(
    "extracts every list flavor from the fixture (%s zip)",
    async (_label, opts) => {
      const vocabs = await extractColumnVocabularies(fixtureBuffer(opts));
      const get = (col) => vocabs.find((v) => v.sheetName === "Data" && v.colLetter === col)?.terms;
      expect(get("A")).toEqual(["cUTI", "Pyelonephritis", "Cystitis"]); // inline list
      expect(get("B")).toEqual(["Amoxicillin", "Ceftriaxone & Co", "Nitrofurantoin", "500"]); // cross-sheet range; entity decoded, inlineStr + numeric read, empty A5 skipped
      expect(get("C")).toEqual(["ICU", "General"]); // named range
      expect(get("D")).toEqual(["Urine", "Blood"]); // x14 extLst validation
      expect(get("E")).toEqual(["Yes", "No"]); // multi-column sqref, first column
      expect(get("F")).toEqual(["Yes", "No"]); // multi-column sqref, second column
      expect(get("G")).toBeUndefined(); // type="whole" is not a picklist
    },
  );
});

describe("P4-3 parseWorkbookFile attaches sheet.vocab by header name", () => {
  it("maps column letters to the parsed headers", async () => {
    const wb = await parseWorkbookFile(stubFile(fixtureBuffer({ deflate: true })));
    const data = wb.sheets.find((s) => s.name === "Data");
    expect(data.vocab).toBeTruthy();
    expect(data.vocab.Diagnosis).toEqual(["cUTI", "Pyelonephritis", "Cystitis"]);
    expect(data.vocab.Ward).toEqual(["ICU", "General"]);
    expect(data.vocab.Source).toEqual(["Urine", "Blood"]);
    expect(data.vocab.Score).toBeUndefined();
  });

  it("still parses a workbook fine when the validation XML can't be read", async () => {
    // A CSV has no zip at all — the vocab path must not break plain uploads.
    const csv = { name: "plain.csv", type: "text/csv", text: async () => "A,B\n1,2\n", arrayBuffer: async () => { throw new Error("no"); } };
    const wb = await parseWorkbookFile(csv);
    expect(wb.sheets[0].rows.length).toBe(1);
    expect(wb.sheets[0].vocab).toBeUndefined();
  });
});

describe("P4-3 Step 3 knows picklist terms even with zero matching rows", () => {
  const sheetWithVocab = () => {
    const s = deriveSheet("Data", [
      { Diagnosis: "Cystitis", Drug: "Amoxicillin" },
      { Diagnosis: "Pyelonephritis", Drug: "Ceftriaxone" },
    ]);
    s.vocab = { Diagnosis: ["cUTI", "Pyelonephritis", "Cystitis"] };
    return { fileName: "f.xlsx", sheets: [s] };
  };

  it("an exact picklist term resolves confidently and answers an honest 0 rows", () => {
    const result = matchRequest("how many patients had cUTI", sheetWithVocab(), { present: false });
    expect(result.status).toBe("confident");
    const res = runOffline("how many patients had cUTI", sheetWithVocab(), {});
    expect(res.kind).toBe("answer");
    expect(res.exec.levels[res.exec.levels.length - 1].count).toBe(0);
  });

  it("nearestSuggestions offers picklist terms as closest-things chips", () => {
    const book = sheetWithVocab();
    const sheet = book.sheets[0];
    const index = new Map();
    for (const h of sheet.headers) index.set(h.name, new Map());
    // the app builds its index through valueIndex; emulate the vocab-merged
    // shape by asking runOffline's decline path instead — here we just check
    // the pure helper accepts vocab-sourced entries in the index
    index.get("Diagnosis").set("cuti", "cUTI");
    const chips = nearestSuggestions("cuti infections", sheet.headers, index, 3);
    expect(chips.some((c) => c.kind === "value" && c.value === "cUTI")).toBe(true);
  });

  it("a term that is neither in the rows nor on any list still declines honestly", () => {
    const res = runOffline("how many patients had zebrafish", sheetWithVocab(), {});
    expect(res.kind).not.toBe("answer");
  });
});

describe("P4-3 Step 2 flags cells not on their column's picklist", () => {
  const sheet = () => {
    const s = deriveSheet("Data", [
      { Diagnosis: "Cystitis", Ward: "ICU" },
      { Diagnosis: "Pyelonefritis", Ward: "General" }, // typo: not on the list
      { Diagnosis: "  cystitis ", Ward: "General" },   // case/space variant: IS on the list once folded
      { Diagnosis: "Pyelonefritis", Ward: "General" }, // same typo again -> 2 cells
    ]);
    s.vocab = { Diagnosis: ["cUTI", "Pyelonephritis", "Cystitis"] };
    return s;
  };

  it("reports the offending cells with samples, as a warn-only finding", () => {
    const findings = checkupSheet(sheet());
    const f = findings.find((x) => x.type === "notInPicklist");
    expect(f).toBeTruthy();
    expect(f.column).toBe("Diagnosis");
    expect(f.count).toBe(2);
    expect(f.samples).toContain("Pyelonefritis");
    expect(f.fixable).toBe(false);
    expect(f.title.toLowerCase()).toContain("dropdown");
  });

  it("is silent when every value folds onto the list, and for columns with no list", () => {
    const clean = deriveSheet("Data", [
      { Diagnosis: "cystitis", Ward: "Anything Goes" },
      { Diagnosis: "CUTI", Ward: "Ward 9¾" },
    ]);
    clean.vocab = { Diagnosis: ["cUTI", "Cystitis"] };
    const findings = checkupSheet(clean);
    expect(findings.find((x) => x.type === "notInPicklist")).toBeUndefined();
  });
});

describe("P4-3 vocab survives checkup fixes (deriveSheet carry-over)", () => {
  it("deriveSheet keeps vocab for columns that still exist", () => {
    const prev = deriveSheet("Data", [{ Diagnosis: "Cystitis", Gone: "x" }]);
    prev.vocab = { Diagnosis: ["cUTI", "Cystitis"], Gone: ["x", "y"] };
    const next = deriveSheet("Data", [{ Diagnosis: "Cystitis" }], prev);
    expect(next.vocab).toEqual({ Diagnosis: ["cUTI", "Cystitis"] });
  });
});
