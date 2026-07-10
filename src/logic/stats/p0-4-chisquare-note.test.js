import { describe, it, expect } from "vitest";
import { analyze } from "./runStats.js";
import { deriveSheet } from "../workbook.js";

function noteFor(steps) {
  return steps.find((s) => s.title === "Which test and why").body;
}

// P0-4: the RxC branch fell through to the 2x2 "all expected counts are 5 or
// more" note even when the smallest expected count was below 5.
describe("P0-4 — contingency test-choice note is honest for every table shape", () => {
  it("2x2 with min expected >= 5 keeps the chi-square-is-reliable note", () => {
    const sheet = deriveSheet("S", [
      ...Array.from({ length: 20 }, () => ({ A: "x", B: "yes" })),
      ...Array.from({ length: 20 }, () => ({ A: "x", B: "no" })),
      ...Array.from({ length: 20 }, () => ({ A: "y", B: "yes" })),
      ...Array.from({ length: 20 }, () => ({ A: "y", B: "no" })),
    ]);
    const result = analyze(sheet, "A", "B");
    expect(result.ok).toBe(true);
    expect(result.is2x2).toBe(true);
    expect(noteFor(result.steps)).toMatch(/All expected counts are 5 or more/);
    expect(result.useFisher).toBe(false);
  });

  it("2x2 with a small expected count switches to Fisher (unchanged)", () => {
    const sheet = deriveSheet("S", [
      { A: "x", B: "yes" }, { A: "x", B: "yes" }, { A: "x", B: "no" },
      { A: "y", B: "yes" }, { A: "y", B: "no" }, { A: "y", B: "no" }, { A: "y", B: "no" },
    ]);
    const result = analyze(sheet, "A", "B");
    expect(result.useFisher).toBe(true);
    expect(noteFor(result.steps)).toMatch(/Fisher's exact test is used instead/);
  });

  it("an RxC table (not 2x2) with a small expected count never claims all counts are >= 5", () => {
    // 3x2 table with a sparse cell, so min expected < 5.
    const rows = [
      ...Array.from({ length: 8 }, () => ({ A: "x", B: "yes" })),
      ...Array.from({ length: 1 }, () => ({ A: "x", B: "no" })),
      ...Array.from({ length: 8 }, () => ({ A: "y", B: "yes" })),
      ...Array.from({ length: 1 }, () => ({ A: "y", B: "no" })),
      ...Array.from({ length: 1 }, () => ({ A: "z", B: "yes" })),
      ...Array.from({ length: 1 }, () => ({ A: "z", B: "no" })),
    ];
    const sheet = deriveSheet("S", rows);
    const result = analyze(sheet, "A", "B");
    expect(result.ok).toBe(true);
    expect(result.is2x2).toBe(false);
    const note = noteFor(result.steps);
    expect(note).not.toMatch(/All expected counts are 5 or more/);
    expect(note).toMatch(/below 5/);
    expect(note).toMatch(/unreliable/i);
    // Chi-square (not Fisher) is still used for a table bigger than 2x2.
    expect(result.testName).toBe("Chi-square test");
  });

  it("an RxC table with every expected count >= 5 keeps the reliable note", () => {
    const rows = [
      ...Array.from({ length: 20 }, () => ({ A: "x", B: "yes" })),
      ...Array.from({ length: 20 }, () => ({ A: "x", B: "no" })),
      ...Array.from({ length: 20 }, () => ({ A: "y", B: "yes" })),
      ...Array.from({ length: 20 }, () => ({ A: "y", B: "no" })),
      ...Array.from({ length: 20 }, () => ({ A: "z", B: "yes" })),
      ...Array.from({ length: 20 }, () => ({ A: "z", B: "no" })),
    ];
    const sheet = deriveSheet("S", rows);
    const result = analyze(sheet, "A", "B");
    expect(result.is2x2).toBe(false);
    expect(noteFor(result.steps)).toMatch(/All expected counts are 5 or more/);
  });
});
