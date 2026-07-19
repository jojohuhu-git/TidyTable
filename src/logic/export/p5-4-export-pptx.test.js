import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { newDeck, addChartSlide, exportChartToPptx } from "./exportPptx.js";

// A 1x1 transparent PNG — pptxgenjs embeds image bytes without validating
// pixel content, so any real PNG signature is enough to exercise the
// pipeline honestly.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
function tinyPngBlob() {
  const bytes = Buffer.from(TINY_PNG_BASE64, "base64");
  return new Blob([bytes], { type: "image/png" });
}

async function slideXmlFiles(pptxBlob) {
  const zip = await JSZip.loadAsync(await pptxBlob.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  return Promise.all(names.sort().map((n) => zip.file(n).async("string")));
}

describe("exportPptx (P5-4)", () => {
  it("exportChartToPptx refuses when there is no chart yet", async () => {
    const res = await exportChartToPptx({ pngBlob: null, title: "X" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no chart/i);
  });

  it("addChartSlide puts the title text and an image on the slide", async () => {
    const pptx = await newDeck();
    await addChartSlide(pptx, { pngBlob: tinyPngBlob(), title: "Drug by Diagnosis", footnote: null });
    const blob = await pptx.write({ outputType: "blob" });
    const [slideXml] = await slideXmlFiles(blob);
    expect(slideXml).toContain("Drug by Diagnosis");
    expect(slideXml).toContain("<p:pic>"); // an embedded picture, not just text
  });

  it("addChartSlide includes the footnote when given, and omits it when not", async () => {
    const withNote = await newDeck();
    await addChartSlide(withNote, { pngBlob: tinyPngBlob(), title: "T", footnote: "Only counting rows where X is Y, n=12." });
    const [xmlWithNote] = await slideXmlFiles(await withNote.write({ outputType: "blob" }));
    expect(xmlWithNote).toContain("n=12");

    const withoutNote = await newDeck();
    await addChartSlide(withoutNote, { pngBlob: tinyPngBlob(), title: "T", footnote: null });
    const [xmlWithoutNote] = await slideXmlFiles(await withoutNote.write({ outputType: "blob" }));
    expect(xmlWithoutNote).not.toContain("n=12");
  });

  it("uses a 16:9 widescreen layout", async () => {
    const pptx = await newDeck();
    await addChartSlide(pptx, { pngBlob: tinyPngBlob(), title: "T" });
    const blob = await pptx.write({ outputType: "blob" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const presXml = await zip.file("ppt/presentation.xml").async("string");
    // cx/cy are EMUs (914400 per inch); 13.333in x 7.5in widescreen
    const [, cx, cy] = presXml.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
    expect(Number(cx) / 914400).toBeCloseTo(13.333, 1);
    expect(Number(cy) / 914400).toBeCloseTo(7.5, 1);
  });
});
