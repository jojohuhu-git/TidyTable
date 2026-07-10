import { describe, it, expect } from "vitest";
import { checkupSheet } from "./scan.js";
import { deriveSheet } from "../workbook.js";

// NEW-3 (datasets-2026-07-09-realworld-examples.md): the DC-abx dataset has
// real trailing-space category duplicates ("ASB" vs "ASB ", "stent" vs
// "stent ", "NKAA" vs "NKAA ") that inflate distinct counts, plus cells with
// embedded newlines. foldKey already trims and collapses all whitespace
// (including newlines) before grouping, so these should already merge
// correctly — this locks that behavior in with the real-world-shaped values
// instead of relying on it staying true by accident.
describe("NEW-3 — trailing-space category variants merge via findCategoryVariants", () => {
  it("merges 'ASB ' into 'ASB' (trailing space, not a real distinct category)", () => {
    const sheet = deriveSheet("D", [
      { PatientID: "P1", UTI: "ASB" }, { PatientID: "P2", UTI: "ASB" }, { PatientID: "P3", UTI: "ASB " },
    ]);
    const findings = checkupSheet(sheet);
    const cv = findings.find((f) => f.type === "categoryVariants" && f.column === "UTI");
    expect(cv).toBeTruthy();
    expect(cv.fix.params.map).toEqual({ "ASB ": "ASB" });
  });

  it("merges 'stent ' into 'stent'", () => {
    const sheet = deriveSheet("D", [
      { PatientID: "P1", "other cUTI": "stent" }, { PatientID: "P2", "other cUTI": "stent" }, { PatientID: "P3", "other cUTI": "stent " },
    ]);
    const findings = checkupSheet(sheet);
    const cv = findings.find((f) => f.type === "categoryVariants" && f.column === "other cUTI");
    expect(cv.fix.params.map).toEqual({ "stent ": "stent" });
  });

  it("a cell with embedded newlines is not silently dropped or corrupted by the merge scan", () => {
    const sheet = deriveSheet("D", [
      { PatientID: "P1", "Urine resistance": "VRE\nBifidobacterium\nCandida glabrata" },
      { PatientID: "P2", "Urine resistance": "Sensitive" },
    ]);
    const findings = checkupSheet(sheet);
    // The multi-line cell is a unique value (not a duplicate spelling of
    // anything), so it correctly produces no merge finding for this column —
    // the important thing is the scan doesn't throw or mangle it.
    const cv = findings.find((f) => f.type === "categoryVariants" && f.column === "Urine resistance");
    expect(cv).toBeUndefined();
    expect(sheet.rows[0]["Urine resistance"]).toBe("VRE\nBifidobacterium\nCandida glabrata");
  });

  it("two cells with the same words but newline vs. space formatting are recognized as the same category", () => {
    const sheet = deriveSheet("D", [
      { PatientID: "P1", Allx: "NKAA" },
      { PatientID: "P2", Allx: "NKAA" },
      { PatientID: "P3", Allx: "NKAA\n" },
    ]);
    const findings = checkupSheet(sheet);
    const cv = findings.find((f) => f.type === "categoryVariants" && f.column === "Allx");
    expect(cv).toBeTruthy();
    expect(cv.fix.params.map).toEqual({ "NKAA\n": "NKAA" });
  });
});
