import { describe, it, expect } from "vitest";
import { Document, Packer } from "docx";
import JSZip from "jszip";
import { buildJournalTable } from "./docxTable.js";

// Renders a real .docx and inspects the generated document.xml directly —
// checking docx.js's internal object shape would be fragile across
// versions; the actual OOXML border markup is what Word actually reads.
async function renderTableXml(table) {
  const doc = new Document({ sections: [{ children: [table] }] });
  const buffer = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml").async("string");
}

describe("buildJournalTable (P5-4)", () => {
  it("returns null for no rows", async () => {
    expect(await buildJournalTable([])).toBeNull();
    expect(await buildJournalTable(null)).toBeNull();
  });

  it("uses Object.keys of the first row when no columns are given", async () => {
    const table = await buildJournalTable([{ Ward: "ICU", Count: 3 }]);
    const xml = await renderTableXml(table);
    expect(xml).toContain("Ward");
    expect(xml).toContain("Count");
    expect(xml).toContain("ICU");
  });

  it("uses the given column order and set, ignoring extra row keys", async () => {
    const table = await buildJournalTable([{ a: 1, b: 2, c: 3 }], ["b", "a"]);
    const xml = await renderTableXml(table);
    const bIdx = xml.indexOf(">b<");
    const aIdx = xml.indexOf(">a<");
    expect(bIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeGreaterThan(bIdx);
    expect(xml).not.toContain(">c<");
  });

  // The table itself also carries a tblBorders block (the fallback for any
  // cell that doesn't override); scope assertions to per-cell tcBorders
  // blocks only, since that's what actually renders for these cells.
  function cellBordersBlocks(xml) {
    return xml.match(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/g) || [];
  }

  it("has no vertical borders on any cell (no left/right rules)", async () => {
    const table = await buildJournalTable([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const xml = await renderTableXml(table);
    const blocks = cellBordersBlocks(xml);
    expect(blocks.length).toBe(4); // header + 3 body cells
    for (const block of blocks) {
      expect(block).toMatch(/<w:left w:val="none"/);
      expect(block).toMatch(/<w:right w:val="none"/);
    }
  });

  it("draws exactly three horizontal rules: above header, below header, below last row", async () => {
    const table = await buildJournalTable([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const xml = await renderTableXml(table);
    const blocks = cellBordersBlocks(xml);
    const topSingles = blocks.filter((b) => /<w:top w:val="single"/.test(b)).length;
    const bottomSingles = blocks.filter((b) => /<w:bottom w:val="single"/.test(b)).length;
    expect(topSingles).toBe(1); // header top only
    expect(bottomSingles).toBe(2); // header bottom + last-row bottom
    const noneTops = blocks.filter((b) => /<w:top w:val="none"/.test(b)).length;
    const noneBottoms = blocks.filter((b) => /<w:bottom w:val="none"/.test(b)).length;
    expect(noneTops).toBe(3); // 3 body rows have no top rule
    expect(noneBottoms).toBe(2); // 2 non-last body rows have no bottom rule
  });

  it("bolds the header row text", async () => {
    const table = await buildJournalTable([{ Name: "x" }]);
    const xml = await renderTableXml(table);
    // header cell run should carry <w:b/>
    const headerCellXml = xml.slice(xml.indexOf("Name") - 200, xml.indexOf("Name"));
    expect(headerCellXml).toContain("<w:b/>");
  });
});
