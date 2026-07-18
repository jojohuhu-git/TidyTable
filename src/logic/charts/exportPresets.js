// P5-2: purpose-sized figure export. The chart SVG is vector, so "export at
// the right size" is nothing but a scale factor — the whole job here is
// honest arithmetic from a purpose (a slide, a poster, a journal column) to
// that scale, plus a legibility check so nobody ships a figure whose axis
// text prints too small to read. Labels stay in plain words; the numbers
// (300 dots per inch, pixel targets) live here and in the "?" note, not in
// the UI labels.

const PRINT_DPI = 300;
// A 16:9 PowerPoint slide is 13.33 inches wide; at the 1920px export target
// that is 144 pixels per inch — used to state slide text size in points.
const SLIDE_PX = { width: 1920, height: 1080 };
const SLIDE_PPI = SLIDE_PX.width / 13.333;
const COLUMN_INCHES = { col1: 3.5, col2: 7 };
// The chart's smallest text (.chart-label in styles.css) is 11px.
const AXIS_TEXT_PX = 11;

export const MIN_LEGIBLE_PT = 8;

export const EXPORT_PRESETS = [
  { id: "slide", label: "Slide (PowerPoint)" },
  { id: "poster", label: "Poster" },
  { id: "col1", label: "Journal figure — single column" },
  { id: "col2", label: "Journal figure — double column" },
];

// { width, height } are the on-screen SVG pixel dimensions. Returns
// { scale, outWidth, outHeight, textPt, warn, warning } — warn is true when
// the chart's smallest text would land under MIN_LEGIBLE_PT at the chosen
// physical size, with a plain-words warning naming the fix.
export function computePresetExport({ width, height }, presetId, opts = {}) {
  let scale;
  let ppi;
  if (presetId === "slide") {
    scale = Math.min(SLIDE_PX.width / width, SLIDE_PX.height / height);
    ppi = SLIDE_PPI;
  } else if (presetId === "poster") {
    const inches = opts.posterInches > 0 ? opts.posterInches : 8;
    scale = (inches * PRINT_DPI) / width;
    ppi = PRINT_DPI;
  } else {
    const inches = COLUMN_INCHES[presetId] || COLUMN_INCHES.col2;
    scale = (inches * PRINT_DPI) / width;
    ppi = PRINT_DPI;
  }
  const textPt = AXIS_TEXT_PX * scale * (72 / ppi);
  const warn = textPt < MIN_LEGIBLE_PT;
  return {
    scale,
    outWidth: width * scale,
    outHeight: height * scale,
    textPt,
    warn,
    warning: warn
      ? `At this size the chart's small text would print at about ${Math.round(textPt * 10) / 10}pt — ` +
        `smaller than the ~${MIN_LEGIBLE_PT}pt most journals consider readable. It may be hard to read; ` +
        `a wider size (like double column) keeps the text legible.`
      : null,
  };
}
