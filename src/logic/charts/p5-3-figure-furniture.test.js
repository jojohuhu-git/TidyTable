import { describe, it, expect } from "vitest";
import { chartPalette, OKABE_ITO } from "./palette.js";
import { buildFigureCaption } from "./chartTitle.js";

// P5-3 (fix-2026-07-11-steps-2-3-9-plain-english.md): figure furniture —
// the logic halves. (1) The grayscale-safe palette: Okabe-Ito hues are not
// reliably distinguishable once printed black-and-white, so grayscale mode
// switches EVERY count to the single-hue dark-to-light ramp, whose ordering
// survives grayscale as shades. (2) The copyable figure caption composed
// from what is actually on the chart — title, footnote, cohort — never
// invented.

describe("P5-3 — grayscale-safe palette", () => {
  it("normal mode keeps Okabe-Ito for short lists (unchanged)", () => {
    expect(chartPalette(4)).toEqual(OKABE_ITO.slice(0, 4));
  });

  it("grayscale mode never returns an Okabe-Ito hue, even for short lists", () => {
    const colors = chartPalette(4, { grayscale: true });
    expect(colors.length).toBe(4);
    for (const c of colors) expect(OKABE_ITO).not.toContain(c);
  });

  it("grayscale colors run dark to light so their order survives B&W printing", () => {
    const lum = (hex) => {
      const h = hex.replace("#", "");
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    const colors = chartPalette(6, { grayscale: true });
    for (let i = 1; i < colors.length; i++) {
      expect(lum(colors[i])).toBeGreaterThan(lum(colors[i - 1]));
    }
  });
});

describe("P5-3 — buildFigureCaption", () => {
  it("composes title, footnote, and cohort sentence into one copyable caption", () => {
    const cap = buildFigureCaption({
      title: "Drug by Diagnosis",
      footnote: "n = 267 encounters, Jan-Jun 2026",
      cohortCaption: 'Only counting rows where "Ward" is "ICU", n=120.',
    });
    expect(cap).toContain("Drug by Diagnosis");
    expect(cap).toContain("n = 267 encounters");
    expect(cap).toContain("ICU");
  });

  it("leaves out what isn't set instead of inventing placeholder text", () => {
    const cap = buildFigureCaption({ title: "count by Diagnosis" });
    expect(cap).toBe("count by Diagnosis.");
    expect(cap).not.toMatch(/undefined|null/);
  });

  it("returns empty for no title (nothing on screen, nothing to caption)", () => {
    expect(buildFigureCaption({})).toBe("");
  });
});
