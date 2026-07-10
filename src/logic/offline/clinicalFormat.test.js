import { describe, it, expect } from "vitest";
import { formatMeanSD, formatMedianIQR, formatNPercent } from "./clinicalFormat.js";

describe("clinicalFormat", () => {
  it("formats mean (SD)", () => {
    expect(formatMeanSD(6, 2.16)).toBe("6 (SD 2.16)");
  });
  it("says plainly when there aren't enough numbers for an SD", () => {
    expect(formatMeanSD(6, null)).toBe("6 (SD not available — fewer than 2 readable numbers)");
  });
  it("says plainly when there is nothing to average at all", () => {
    expect(formatMeanSD(null, null)).toBe("no readable numbers");
  });

  it("formats median (IQR)", () => {
    expect(formatMedianIQR(6, 4, 9)).toBe("6 (IQR 4–9)");
  });
  it("says plainly when there is nothing to report", () => {
    expect(formatMedianIQR(null, null, null)).toBe("no readable numbers");
  });

  it("formats n (%) against a cohort total", () => {
    expect(formatNPercent(14, 20)).toBe("14 (70%)");
    expect(formatNPercent(1, 3)).toBe("1 (33.3%)");
  });
  it("handles a zero denominator without dividing by zero", () => {
    expect(formatNPercent(0, 0)).toBe("0 (0%)");
  });
});
