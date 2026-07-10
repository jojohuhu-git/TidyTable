// B9: serialize the existing SVG preview to a PNG download — no chart-library
// dependency, no server round-trip. svg -> Blob URL -> Image -> canvas ->
// PNG Blob -> anchor click, the standard no-dependency recipe.
export function downloadChartPng(svgEl, filename = "chart.png", scale = 2) {
  if (!svgEl) return;
  const width = Number(svgEl.getAttribute("width")) || svgEl.viewBox?.baseVal?.width || 480;
  const height = Number(svgEl.getAttribute("height")) || svgEl.viewBox?.baseVal?.height || 300;

  const svgData = new XMLSerializer().serializeToString(svgEl);
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
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
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };
  img.src = url;
}
