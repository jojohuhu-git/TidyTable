import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildWorkbookXlsx } from "./workbook.js";

// W1: Step 2's "download your fixed file" button. The exported workbook must
// contain every sheet — the cleaned first sheet plus any other sheets left
// untouched — so nothing the user had is silently dropped from the download.
function twoSheetWorkbook() {
  return {
    fileName: "DC antibiotics.xlsx",
    sheets: [
      {
        name: "Encounters",
        headers: [{ name: "Patient" }, { name: "Organism" }],
        rows: [
          { Patient: "P1", Organism: "ESCHERICHIA COLI" },
          { Patient: "P2", Organism: "KLEBSIELLA" },
        ],
      },
      {
        name: "Roster",
        headers: [{ name: "Prescriber" }],
        rows: [{ Prescriber: "Dr. A" }],
      },
    ],
  };
}

describe("W1 — buildWorkbookXlsx", () => {
  it("includes every sheet in the workbook, not just the cleaned first one", () => {
    const wb = buildWorkbookXlsx(twoSheetWorkbook());
    expect(wb.SheetNames).toEqual(["Encounters", "Roster"]);
  });

  it("the cleaned rows appear in sheet 1", () => {
    const wb = buildWorkbookXlsx(twoSheetWorkbook());
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Encounters"]);
    expect(rows).toEqual([
      { Patient: "P1", Organism: "ESCHERICHIA COLI" },
      { Patient: "P2", Organism: "KLEBSIELLA" },
    ]);
  });

  it("later sheets are carried through untouched", () => {
    const wb = buildWorkbookXlsx(twoSheetWorkbook());
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Roster"]);
    expect(rows).toEqual([{ Prescriber: "Dr. A" }]);
  });

  it("keeps columns in the sheet's own header order, including an all-blank column", () => {
    const wb = {
      fileName: "gaps.xlsx",
      sheets: [
        {
          name: "S1",
          headers: [{ name: "A" }, { name: "B" }, { name: "C" }],
          rows: [{ A: 1, B: null, C: 3 }],
        },
      ],
    };
    const built = buildWorkbookXlsx(wb);
    const matrix = XLSX.utils.sheet_to_json(built.Sheets["S1"], { header: 1 });
    expect(matrix[0]).toEqual(["A", "B", "C"]);
  });

  it("sanitizes and de-duplicates sheet names so a bad name never throws", () => {
    const wb = {
      fileName: "weird.xlsx",
      sheets: [
        { name: "A/B:C*D?E[F]G", headers: [{ name: "X" }], rows: [{ X: 1 }] },
        { name: "A/B:C*D?E[F]G", headers: [{ name: "X" }], rows: [{ X: 2 }] },
      ],
    };
    const built = buildWorkbookXlsx(wb);
    expect(built.SheetNames.length).toBe(2);
    expect(new Set(built.SheetNames).size).toBe(2);
    for (const n of built.SheetNames) expect(n.length).toBeLessThanOrEqual(31);
  });
});
