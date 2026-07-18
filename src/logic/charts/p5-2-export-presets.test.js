import { describe, it, expect } from "vitest";
import { EXPORT_PRESETS, computePresetExport, MIN_LEGIBLE_PT } from "./exportPresets.js";

// P5-2 (fix-2026-07-11-steps-2-3-9-plain-english.md): purpose-sized figure
// export. Three preset targets replace the one-size PNG: a PowerPoint slide
// (fit 1920x1080), a poster (300 dots per inch at a chosen width in inches),
// and journal figures (300 dpi at the standard 3.5in single / 7in double
// column). Fonts scale with the export (the SVG is vector — scale is the
// whole job), and a legibility check warns when the chart's 11px axis text
// would land under ~8 printed points at the chosen size — never silently
// producing an unreadable figure.

const CHART = { width: 480, height: 300 };

describe("P5-2 — preset list", () => {
  it("offers exactly the four purpose presets, in plain words", () => {
    expect(EXPORT_PRESETS.map((p) => p.id)).toEqual(["slide", "poster", "col1", "col2"]);
    for (const p of EXPORT_PRESETS) expect(p.label).not.toMatch(/dpi|px/i);
  });
});

describe("P5-2 — computePresetExport sizes", () => {
  it("slide: scales to fit inside 1920x1080 (a 480x300 chart is height-bound: x4 would overflow 1080)", () => {
    const r = computePresetExport(CHART, "slide");
    expect(r.scale).toBeCloseTo(3.6, 5);
    expect(Math.round(r.outWidth)).toBe(1728);
    expect(Math.round(r.outHeight)).toBe(1080);
  });

  it("slide: a tall chart is height-bound so it never overflows the slide", () => {
    const r = computePresetExport({ width: 480, height: 542 }, "slide");
    expect(r.outHeight).toBeLessThanOrEqual(1080);
    expect(r.outWidth).toBeLessThanOrEqual(1920);
    expect(Math.round(r.outHeight)).toBe(1080);
  });

  it("poster: 300 dpi at the chosen width in inches, default 8in -> 2400px", () => {
    expect(computePresetExport(CHART, "poster").outWidth).toBe(2400);
    expect(computePresetExport(CHART, "poster", { posterInches: 10 }).outWidth).toBe(3000);
  });

  it("journal columns: 3.5in -> 1050px, 7in -> 2100px at 300 dpi", () => {
    expect(computePresetExport(CHART, "col1").outWidth).toBe(1050);
    expect(computePresetExport(CHART, "col2").outWidth).toBe(2100);
  });
});

describe("P5-2 — legibility check", () => {
  it("warns for a single-column journal figure (11px text prints under 8pt)", () => {
    const r = computePresetExport(CHART, "col1");
    expect(r.textPt).toBeLessThan(MIN_LEGIBLE_PT);
    expect(r.warn).toBe(true);
    expect(r.warning).toMatch(/text/i);
  });

  it("does not warn for poster or double-column sizes", () => {
    expect(computePresetExport(CHART, "poster").warn).toBe(false);
    expect(computePresetExport(CHART, "col2").warn).toBe(false);
  });

  it("does not warn for a slide-sized export of a standard chart", () => {
    expect(computePresetExport(CHART, "slide").warn).toBe(false);
  });

  it("print text size is honest arithmetic: pixels x scale, at 300 dots per inch, in points", () => {
    const r = computePresetExport(CHART, "poster"); // scale 5
    expect(r.textPt).toBeCloseTo(11 * 5 * (72 / 300), 1); // 13.2pt
  });
});
