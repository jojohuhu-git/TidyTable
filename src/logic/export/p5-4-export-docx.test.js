import { describe, it, expect } from "vitest";
import { Document, Packer } from "docx";
import JSZip from "jszip";
import { buildResultSection } from "./exportDocx.js";

async function renderXml(children) {
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml").async("string");
}

describe("buildResultSection (P5-4)", () => {
  it("returns [] for a rows-less result — never emits an empty table", async () => {
    expect(await buildResultSection({ title: "Empty", rows: [] })).toEqual([]);
    expect(await buildResultSection({ title: "Empty", rows: null })).toEqual([]);
  });

  it("includes a heading, the note, and the table", async () => {
    const section = await buildResultSection({
      title: "Ward counts",
      note: "3 rows matched, split by ward.",
      rows: [{ Ward: "ICU", Count: 2 }, { Ward: "ER", Count: 1 }],
    });
    expect(section.length).toBe(3); // heading + note + table
    const xml = await renderXml(section);
    expect(xml).toContain("Ward counts");
    expect(xml).toContain("3 rows matched, split by ward.");
    expect(xml).toContain("ICU");
    expect(xml).toContain("ER");
  });

  it("omits the note paragraph when none is given", async () => {
    const section = await buildResultSection({ title: "No note", rows: [{ a: 1 }] });
    expect(section.length).toBe(2); // heading + table, no note paragraph
  });

  it("respects an explicit column subset/order", async () => {
    const section = await buildResultSection({
      title: "Subset",
      rows: [{ a: 1, b: 2, c: 3 }],
      columns: ["c", "a"],
    });
    const xml = await renderXml(section);
    const cIdx = xml.indexOf(">c<");
    const aIdx = xml.indexOf(">a<");
    expect(cIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeGreaterThan(cIdx);
    expect(xml).not.toContain(">b<");
  });
});
