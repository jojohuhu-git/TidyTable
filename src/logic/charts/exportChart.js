// P5-1: zero-dependency chart exports — a standalone SVG download (vector,
// scales to any poster size) and copy-to-clipboard PNG (paste straight into
// PowerPoint/Word). The one real problem to solve: the live chart SVG leans
// on the page's CSS — var(--accent) fills and class-styled text — which all
// dies the moment the file leaves the app (Illustrator, PowerPoint, or an
// <img> tag see unresolved variables as missing). serializeChartSvg inlines
// the browser's COMPUTED values at export time, so what leaves the app is
// exactly what was on screen.

const INLINE_PROPS = ["fill", "stroke", "font-family", "font-size", "font-weight", "opacity"];

export function serializeChartSvg(svgEl) {
  const clone = svgEl.cloneNode(true);
  const src = [svgEl, ...svgEl.querySelectorAll("*")];
  const dst = [clone, ...clone.querySelectorAll("*")];
  for (let i = 0; i < src.length; i++) {
    let computed = null;
    try {
      computed = window.getComputedStyle(src[i]);
    } catch {
      computed = null;
    }
    if (!computed) continue;
    for (const prop of INLINE_PROPS) {
      const v = computed.getPropertyValue(prop);
      // Only write values the browser actually resolved — a test DOM (or an
      // unstyled node) returns "", and overwriting real attributes with ""
      // would blank the chart instead of preserving it.
      if (v) dst[i].setAttribute(prop, v);
    }
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(clone);
}

function svgDims(svgEl) {
  return {
    width: Number(svgEl.getAttribute("width")) || svgEl.viewBox?.baseVal?.width || 480,
    height: Number(svgEl.getAttribute("height")) || svgEl.viewBox?.baseVal?.height || 300,
  };
}

export function downloadChartSvg(svgEl, filename = "chart.svg") {
  if (!svgEl) return;
  const blob = new Blob([serializeChartSvg(svgEl)], { type: "image/svg+xml;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// The raster core shared by the PNG download and the clipboard copy: svg ->
// Blob URL -> Image -> canvas (white background — rasters have no honest
// transparency in slides) -> PNG Blob.
export function svgToPngBlob(svgEl, scale = 2) {
  return new Promise((resolve, reject) => {
    const { width, height } = svgDims(svgEl);
    const svgBlob = new Blob([serializeChartSvg(svgEl)], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG could not be rendered"));
    };
    img.src = url;
  });
}

// Copy the chart to the clipboard as a PNG. Returns { ok, message } and
// never pretends: an unsupported browser or a blocked clipboard is reported
// plainly, pointing at the download buttons that always work. The Blob is
// handed to ClipboardItem as a promise — that keeps the write inside the
// click's user-gesture window (Safari requires this).
export async function copyChartPng(svgEl, scale = 2) {
  if (!svgEl) return { ok: false, message: "There is no chart to copy yet." };
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return { ok: false, message: "Copying images isn't available in this browser — use Download chart as image instead." };
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": svgToPngBlob(svgEl, scale) })]);
    return { ok: true, message: "Chart copied — paste it into PowerPoint or Word." };
  } catch {
    return { ok: false, message: "Couldn't copy the chart — your browser blocked it. Use Download chart as image instead." };
  }
}
