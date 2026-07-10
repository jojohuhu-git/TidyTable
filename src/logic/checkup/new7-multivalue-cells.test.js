import { describe, it, expect } from "vitest";
import { parseDates, coerceNumbers, sentinelBlanks } from "./normalizers.js";
import { checkupSheet } from "./scan.js";
import { deriveSheet } from "../workbook.js";

// NEW-7 (datasets-2026-07-09-realworld-examples.md): several real columns
// pack more than one value into a cell ("05/17/2026; 05/21/2026" for a
// return-date column, "Levofloxacin; Metronidazole" for a drug list). The
// hard requirement is that no normalizer silently parses only the first
// value and drops the rest — that would be a silent A1-class corruption.
// (A "split multi-value column" cleaning capability is explicitly scoped as
// its own future item, not required here.)
describe("NEW-7 — a multi-date cell is left unchanged, not corrupted to the first date", () => {
  it("parseDates does not touch a semicolon-separated multi-date cell", () => {
    const cell = "05/17/2026; 05/21/2026";
    expect(parseDates(cell, "MDY")).toBe(cell);
  });

  it("findTextDates does not offer to 'fix' (and thereby truncate) a multi-date cell", () => {
    const sheet = deriveSheet("D", [
      { ReturnDate: "05/17/2026; 05/21/2026" },
      { ReturnDate: "3/4/2024" }, // a genuine single date, still detected normally
    ]);
    const findings = checkupSheet(sheet);
    const dateFinding = findings.find((f) => f.type === "textDates" && f.column === "ReturnDate");
    expect(dateFinding).toBeTruthy();
    // Only the genuine single date is counted/sampled — the multi-date cell
    // never appears as something the fix would rewrite.
    expect(dateFinding.count).toBe(1);
    expect(dateFinding.samples).not.toContain("05/17/2026; 05/21/2026");
  });
});

describe("NEW-7 — other normalizers leave a semicolon/newline multi-value cell alone", () => {
  it("coerceNumbers does not parse a leading number out of a multi-value cell", () => {
    expect(coerceNumbers("5; 10")).toBe("5; 10");
  });

  it("sentinelBlanks does not blank a cell that merely starts with a sentinel-like word", () => {
    // Real fixture: DC-abx "Blood Organisms" style cell — not literally "N/A"
    // itself, so must not be blanked.
    expect(sentinelBlanks("N/A; Candida glabrata")).toBe("N/A; Candida glabrata");
  });

  it("a multi-drug cell is preserved verbatim through the pipeline (no normalizer mangles it)", () => {
    const cell = "Levofloxacin; Metronidazole";
    expect(coerceNumbers(cell)).toBe(cell);
    expect(sentinelBlanks(cell)).toBe(cell);
    expect(parseDates(cell, "MDY")).toBe(cell);
  });
});
