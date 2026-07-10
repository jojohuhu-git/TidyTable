import { describe, it, expect } from "vitest";
import { checkupSheet } from "./scan.js";
import { deriveSheet } from "../workbook.js";

// NEW-8 (datasets-2026-07-09-realworld-examples.md): the ED-urine dataset's
// WBCs column has 3 real values — "</= 10", "> 10", "N/A" — where "N/A" is a
// genuine "not tested" category, not scattered missing data. Blanket-
// converting it to empty would erase real signal. Only suppress the
// sentinel-as-missing reading when the column's other values form a small
// closed set of real TEXT labels; a numeric/duration column with a small
// sample (and thus coincidentally few distinct numbers) must still flag N/A
// as missing as before.
function wbcsSheet() {
  return deriveSheet("D", [
    { PatientID: "P1", WBCs: "</= 10" },
    { PatientID: "P2", WBCs: "> 10" },
    { PatientID: "P3", WBCs: "N/A" },
    { PatientID: "P4", WBCs: "</= 10" },
    { PatientID: "P5", WBCs: "N/A" },
  ]);
}

describe("NEW-8 — a sentinel token that is really a closed-vocabulary category is not auto-blanked", () => {
  it("does not offer a sentinelBlanks fix for WBCs' N/A category", () => {
    const findings = checkupSheet(wbcsSheet());
    const missingFinding = findings.find((f) => f.type === "missing" && f.column === "WBCs");
    expect(missingFinding).toBeUndefined();
  });

  it("N/A survives untouched in the underlying data (nothing ran on it)", () => {
    const sheet = wbcsSheet();
    expect(sheet.rows.filter((r) => r.WBCs === "N/A")).toHaveLength(2);
  });

  it("a genuinely missing scattering of N/A in a small numeric column is still flagged", () => {
    // Small sample, few distinct numbers by chance — must NOT be mistaken
    // for a closed category set the way WBCs is.
    const sheet = deriveSheet("D", [
      { PatientID: "P1", Duration_days: 5 },
      { PatientID: "P2", Duration_days: 5 },
      { PatientID: "P3", Duration_days: "N/A" },
      { PatientID: "P4", Duration_days: 7 },
    ]);
    const findings = checkupSheet(sheet);
    const missingFinding = findings.find((f) => f.type === "missing" && f.column === "Duration_days");
    expect(missingFinding).toBeTruthy();
    expect(missingFinding.fixable).toBe(true);
    expect(missingFinding.count).toBe(1);
  });

  it("a column of only 'N/A' values with no other category present is still flagged as missing", () => {
    const sheet = deriveSheet("D", [
      { PatientID: "P1", X: "N/A" }, { PatientID: "P2", X: "N/A" }, { PatientID: "P3", X: 5 },
    ]);
    // Here X has a real value (5) plus N/A — only one non-sentinel distinct
    // value and it's numeric, so this is a numeric column with missing data,
    // not a closed text-category field.
    const findings = checkupSheet(sheet);
    const missingFinding = findings.find((f) => f.type === "missing" && f.column === "X");
    expect(missingFinding).toBeTruthy();
    expect(missingFinding.fixable).toBe(true);
  });

  it("WBCs' '> 10' / '</= 10' are flagged as censored/threshold results, not counted as bare numbers", () => {
    const findings = checkupSheet(wbcsSheet());
    const censored = findings.find((f) => f.type === "censored" && f.column === "WBCs");
    expect(censored).toBeTruthy();
    expect(censored.fixable).toBe(true);
    expect(censored.samples).toContain("> 10");
    expect(censored.samples).toContain("</= 10");
  });
});
