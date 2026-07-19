// P5-4: PowerPoint (.pptx) export. Client-side only, nothing leaves the
// browser — pptxgenjs is dynamically imported so it never enters the main
// bundle until an export actually runs. Takes an already-rasterized PNG
// Blob rather than an SVG element/ref: the SVG-to-PNG step is
// exportChart.js's svgToPngBlob (P5-1, tested there), a DOM/Image pipeline
// that can't run in this module's own tests — callers do that step first
// (ChartsPanel.jsx already does, for the PNG download/clipboard copy), so
// this module stays pure and independently testable.

import { sanitizeFileBase, downloadBlob } from "./downloadFile.js";

// Widescreen (16:9) layout, inches — matches PowerPoint's default modern
// slide size so a pasted/exported slide isn't letterboxed.
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

async function blobToDataUrl(blob, mime = "image/png") {
  const buf = await blob.arrayBuffer();
  const base64 = typeof Buffer !== "undefined"
    ? Buffer.from(buf).toString("base64")
    : btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `data:${mime};base64,${base64}`;
}

// One slide: title, the chart image (aspect-preserved, "contain" so it
// never distorts), and the n= footnote if there is one. Exported so the
// "Export all results" deck builder can add one slide per chart to a
// single shared deck.
export async function addChartSlide(pptx, { pngBlob, title, footnote }) {
  const dataUrl = await blobToDataUrl(pngBlob);
  const slide = pptx.addSlide();
  slide.addText(title || "Chart", { x: 0.5, y: 0.3, w: SLIDE_W - 1, h: 0.7, fontSize: 24, bold: true, fontFace: "Arial" });
  slide.addImage({
    data: dataUrl,
    x: 0.75, y: 1.15, w: SLIDE_W - 1.5, h: SLIDE_H - 2.15,
    sizing: { type: "contain", w: SLIDE_W - 1.5, h: SLIDE_H - 2.15 },
  });
  if (footnote) {
    slide.addText(footnote, { x: 0.5, y: SLIDE_H - 0.55, w: SLIDE_W - 1, h: 0.4, fontSize: 12, color: "666666", fontFace: "Arial" });
  }
}

export function newDeck() {
  return import("pptxgenjs").then(({ default: PptxGenJS }) => {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "TIDYTABLE_WIDE", width: SLIDE_W, height: SLIDE_H });
    pptx.layout = "TIDYTABLE_WIDE";
    return pptx;
  });
}

// "Send to PowerPoint" on a chart — one 16:9 slide with title, figure, and
// n= footnote.
export async function exportChartToPptx({ pngBlob, title, footnote, fileName }) {
  if (!pngBlob) return { ok: false, message: "There is no chart to export yet." };
  const pptx = await newDeck();
  await addChartSlide(pptx, { pngBlob, title, footnote });
  const blob = await pptx.write({ outputType: "blob" });
  downloadBlob(blob, `${sanitizeFileBase(fileName || title)}.pptx`);
  return { ok: true, message: "Downloaded — open it in PowerPoint." };
}
