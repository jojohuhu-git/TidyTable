// W4 chart palettes. Two jobs, both "aesthetically matched but distinct" with
// no new dependencies — plain hex arrays only.
//
// 1) A short series (≤ 8 distinct categories, or pie slices): the Okabe-Ito
//    colorblind-safe qualitative palette. It is the standard eight-color set
//    designed to stay distinguishable under the common forms of color-vision
//    deficiency, so a novice's chart is readable by the widest audience
//    without them having to think about it. Order is the published one.
//
// 2) A long horizontal bar list (many categories): one hue can't stay
//    distinct across 40 bars, and it shouldn't try — the bars are already
//    separated by position and label. Instead we use a single-hue teal ramp
//    (matching the app's accent) that steps from dark to light down the
//    sorted list, with the TOP 3 bars held at the strongest shades so the
//    biggest categories read first. This is "matching but distinct": one
//    coherent color family, with emphasis where it counts.

// The Okabe-Ito 8-color qualitative palette (black omitted — it reads as an
// axis, not a series). These exact hexes are the widely-cited values.
export const OKABE_ITO = [
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#009E73", // bluish green
  "#F0E442", // yellow
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#000000", // black (last resort, ≥8 series)
];

// The app accent as the ramp's darkest anchor, lightening toward a pale tint.
// Top-3 emphasis shades sit at the dark end so the largest bars stand out.
const RAMP_DARK = "#0e6b63"; // --accent
const RAMP_LIGHT = "#bfe0db"; // pale teal, still on-brand

// Parse "#rrggbb" -> [r, g, b].
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function rgbToHex(rgb) {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

// Linear blend between two hex colors, t in [0, 1].
function mix(a, b, t) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return rgbToHex(ra.map((v, i) => v + (rb[i] - v) * t));
}

// Public: colors for `count` categories, best palette for the count.
//   - count ≤ 8 → Okabe-Ito, first `count` colors.
//   - count > 8 → single-hue teal ramp, dark (largest, first) to light
//     (smallest, last). The first three entries are held at the darkest shades
//     so the top-3 bars are emphasized, per the owner's "matching but
//     distinct" ask. Assumes the caller feeds points already sorted
//     largest-first (aggregate.js does).
export function chartPalette(count) {
  if (count <= 0) return [];
  if (count <= OKABE_ITO.length) return OKABE_ITO.slice(0, count);

  const colors = [];
  // Top 3 emphasized: fixed dark shades before the ramp begins.
  const EMPHASIS = [RAMP_DARK, mix(RAMP_DARK, RAMP_LIGHT, 0.12), mix(RAMP_DARK, RAMP_LIGHT, 0.24)];
  const emphN = Math.min(3, count);
  for (let i = 0; i < emphN; i++) colors.push(EMPHASIS[i]);
  // Remaining bars ramp from just after the emphasis band to the light end.
  const rest = count - emphN;
  for (let i = 0; i < rest; i++) {
    const t = 0.35 + (0.65 * (rest === 1 ? 1 : i / (rest - 1)));
    colors.push(mix(RAMP_DARK, RAMP_LIGHT, t));
  }
  return colors;
}

// Whether a category count should use the multi-color qualitative palette
// (short list / pie) rather than the single-hue ramp — handy for the UI's
// "these are the colors" legend note.
export function isQualitative(count) {
  return count > 0 && count <= OKABE_ITO.length;
}
