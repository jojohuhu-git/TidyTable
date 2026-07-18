import { describe, it, expect } from "vitest";
import { countLabel, fmtChartNumber } from "./aggregate.js";

// P5-6 (fix-2026-07-11-steps-2-3-9-plain-english.md): figure polish —
// thousands separators on every number a chart displays, in the clinical
// n (%) convention where it already applies. (The rest of P5-6 is already
// true by construction: fonts inline into exports via serializeChartSvg,
// and the P5-2 preset math keeps slide-size axis text at ~20pt.)

describe("P5-6 — fmtChartNumber", () => {
  it("adds thousands separators to large whole numbers", () => {
    expect(fmtChartNumber(1240)).toBe("1,240");
    expect(fmtChartNumber(1240000)).toBe("1,240,000");
  });

  it("leaves small numbers and decimals readable, never rounding them away", () => {
    expect(fmtChartNumber(7)).toBe("7");
    expect(fmtChartNumber(3.75)).toBe("3.75");
  });
});

describe("P5-6 — countLabel uses separators in the n (%) convention", () => {
  it("formats a large count as n (%) with separators", () => {
    expect(countLabel(1240, 3650)).toBe("1,240 (34%)");
  });

  it("still falls back to the bare (separated) number with no denominator", () => {
    expect(countLabel(1240, null)).toBe("1,240");
  });
});
