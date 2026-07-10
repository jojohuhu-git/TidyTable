import { describe, it, expect } from "vitest";
import { buildColumnProfile } from "./columnProfile.js";
import { deriveSheet } from "./workbook.js";

describe("B6 — buildColumnProfile", () => {
  it("reports % filled, distinct count, and a min-max summary for a numeric column", () => {
    const sheet = deriveSheet("D", [
      { Age: 10 }, { Age: 20 }, { Age: 30 }, { Age: null },
    ]);
    const profile = buildColumnProfile(sheet);
    const age = profile.find((p) => p.name === "Age");
    expect(age.filledPct).toBe(75);
    expect(age.distinctCount).toBe(3);
    expect(age.summary).toBe("10 – 30");
    expect(age.isEmpty).toBe(false);
    expect(age.isConstant).toBe(false);
  });

  it("reports top-3 values by frequency for a text column", () => {
    const sheet = deriveSheet("D", [
      { Dx: "UTI" }, { Dx: "UTI" }, { Dx: "UTI" }, { Dx: "pneumonia" }, { Dx: "pneumonia" }, { Dx: "cystitis" },
    ]);
    const profile = buildColumnProfile(sheet);
    const dx = profile.find((p) => p.name === "Dx");
    expect(dx.summary).toBe("UTI (3), pneumonia (2), cystitis (1)");
    expect(dx.distinctCount).toBe(3);
  });

  it("flags a fully empty column", () => {
    const sheet = deriveSheet("D", [{ A: 1, B: null }, { A: 2, B: null }]);
    const profile = buildColumnProfile(sheet);
    const b = profile.find((p) => p.name === "B");
    expect(b.isEmpty).toBe(true);
    expect(b.filledPct).toBe(0);
    expect(b.summary).toBe("empty column");
  });

  it("flags a constant column (same value every row)", () => {
    const sheet = deriveSheet("D", [{ Site: "North" }, { Site: "North" }, { Site: "North" }]);
    const profile = buildColumnProfile(sheet);
    const site = profile.find((p) => p.name === "Site");
    expect(site.isConstant).toBe(true);
    expect(site.distinctCount).toBe(1);
    expect(site.summary).toBe("North (3)");
  });

  it("only samples the first 500 rows on a large sheet", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ V: i < 500 ? "early" : "late" }));
    const sheet = deriveSheet("D", rows);
    const profile = buildColumnProfile(sheet);
    const v = profile.find((p) => p.name === "V");
    // Only "early" appears in the first 500 rows, so "late" never shows up.
    expect(v.summary).toBe("early (500)");
    expect(v.sampledRows).toBe(500);
    expect(v.totalRows).toBe(1000);
  });
});
