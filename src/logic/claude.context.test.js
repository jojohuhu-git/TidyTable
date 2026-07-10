import { describe, it, expect } from "vitest";
import { buildDataContext } from "./claude.js";

const workbook = {
  fileName: "patients.xlsx",
  sheets: [
    {
      name: "Sheet1",
      rowCount: 3,
      headers: [
        { letter: "A", name: "Name", type: "text", samples: ["Alice Johnson", "Bob Lee"] },
        { letter: "B", name: "MRN", type: "text", samples: ["MRN-00042"] },
        { letter: "C", name: "DOB", type: "date", samples: ["1961-08-14"] },
        { letter: "D", name: "Dose_mg", type: "number", samples: ["500"] },
      ],
      rows: [
        { Name: "Alice Johnson", MRN: "MRN-00042", DOB: "1961-08-14", Dose_mg: 500 },
        { Name: "Bob Lee", MRN: "MRN-00043", DOB: "1972-01-02", Dose_mg: 250 },
        { Name: "Carol Diaz", MRN: "MRN-00044", DOB: "1980-11-30", Dose_mg: 750 },
      ],
    },
  ],
};

describe("buildDataContext privacy", () => {
  it("sample mode never sends real cell values", () => {
    const ctx = buildDataContext(workbook, { excluded: new Set(), privacyMode: "sample" });
    for (const secret of ["Alice", "Johnson", "Bob Lee", "Carol", "MRN-00042", "1961-08-14"]) {
      expect(ctx).not.toContain(secret);
    }
    // But structure IS sent: headers, letters, types.
    expect(ctx).toContain('"Name"');
    expect(ctx).toContain('"DOB"');
    expect(ctx).toContain("made-up");
  });

  it("full mode does send real values (explicit opt-in)", () => {
    const ctx = buildDataContext(workbook, { excluded: new Set(), privacyMode: "full" });
    expect(ctx).toContain("Alice Johnson");
    expect(ctx).toContain("MRN-00042");
    expect(ctx).not.toContain("made-up");
  });

  it("excluded columns are withheld in both modes", () => {
    const ctx = buildDataContext(workbook, {
      excluded: new Set(["Sheet1::MRN"]),
      privacyMode: "full",
    });
    expect(ctx).not.toContain("MRN-00042");
    expect(ctx).toContain("withheld");
  });
});
