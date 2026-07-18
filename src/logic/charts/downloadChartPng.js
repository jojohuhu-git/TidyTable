// B9: serialize the existing SVG preview to a PNG download — no chart-library
// dependency, no server round-trip. P5-1: the raster core moved to
// exportChart.js (shared with copy-to-clipboard), which also inlines the
// page's computed styles so var(--accent) fills survive outside the app.
import { svgToPngBlob } from "./exportChart.js";

export function downloadChartPng(svgEl, filename = "chart.png", scale = 2) {
  if (!svgEl) return;
  svgToPngBlob(svgEl, scale)
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(() => {});
}
