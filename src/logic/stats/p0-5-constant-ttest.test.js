import { describe, it, expect } from "vitest";
import { tTestWelch } from "./ttest.js";
import { analyze } from "./runStats.js";
import { deriveSheet } from "../workbook.js";

// P0-5: se === 0 (zero variance in both groups) previously produced literal
// NaN/Infinity instead of a plain refusal.
describe("P0-5 — a constant (zero-variance) group refuses instead of producing NaN", () => {
  it("tTestWelch itself is NaN/Infinity today when both groups are constant (documents the raw behavior)", () => {
    const tt = tTestWelch([5, 5, 5], [5, 5, 5]);
    expect(Number.isNaN(tt.t) || Number.isNaN(tt.statistic) || !Number.isFinite(tt.statistic)).toBe(true);
  });

  it("analyze() refuses with a plain message when both groups are identical (equal means, no spread)", () => {
    const sheet = deriveSheet("S", [
      { Grp: "A", Val: 5 }, { Grp: "A", Val: 5 }, { Grp: "A", Val: 5 },
      { Grp: "B", Val: 5 }, { Grp: "B", Val: 5 }, { Grp: "B", Val: 5 },
    ]);
    const result = analyze(sheet, "Val", "Grp");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no variation to test/i);
    expect(JSON.stringify(result)).not.toMatch(/NaN/);
  });

  it("analyze() refuses with a plain message when means differ but neither group has spread", () => {
    const sheet = deriveSheet("S", [
      { Grp: "A", Val: 5 }, { Grp: "A", Val: 5 }, { Grp: "A", Val: 5 },
      { Grp: "B", Val: 9 }, { Grp: "B", Val: 9 }, { Grp: "B", Val: 9 },
    ]);
    const result = analyze(sheet, "Val", "Grp");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no spread/i);
    expect(result.message).toMatch(/4/); // states the exact difference (9-5=4)
    expect(JSON.stringify(result)).not.toMatch(/NaN/);
  });

  it("a normal two-group comparison with real variation still works", () => {
    const sheet = deriveSheet("S", [
      { Grp: "A", Val: 5 }, { Grp: "A", Val: 6 }, { Grp: "A", Val: 4 },
      { Grp: "B", Val: 9 }, { Grp: "B", Val: 10 }, { Grp: "B", Val: 8 },
    ]);
    const result = analyze(sheet, "Val", "Grp");
    expect(result.ok).toBe(true);
    expect(Number.isFinite(result.statistic)).toBe(true);
  });

  // NEW-6: the real dataset's constant columns (all "Yes" / all "No").
  it("NEW-6 fixture: an all-'Yes' outcome column against a real grouping column refuses cleanly", () => {
    const sheet = deriveSheet("S", [
      { Grp: "A", Indication: 1 }, { Grp: "A", Indication: 1 }, { Grp: "A", Indication: 1 },
      { Grp: "B", Indication: 1 }, { Grp: "B", Indication: 1 }, { Grp: "B", Indication: 1 },
    ]);
    const result = analyze(sheet, "Indication", "Grp");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no variation to test/i);
  });
});
