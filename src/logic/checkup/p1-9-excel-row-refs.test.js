import { describe, it, expect } from "vitest";
import { parseWorkbookFile, excelRowExtent, excelRowExtentNote, deriveSheet } from "../workbook.js";
import { buildFixPlan } from "./buildFixPlan.js";

function csvFile(text, name = "test.csv") {
  return new File([text], name, { type: "text/csv" });
}

// P1-9: Excel-step ranges used to always assume "row 2 to rows.length+1",
// which is wrong whenever the sheet has blank rows inside the data (dropped
// before `rows` is built) or doesn't start at row 1. parseWorkbookFile now
// records the real physical extent, and Excel-step generators use it.
describe("P1-9 — parseWorkbookFile records the real physical row extent", () => {
  it("a tidy sheet (no blank rows, starts at row 1) needs no honesty note", async () => {
    const csv = "A,B\n1,x\n2,y\n3,z\n";
    const result = await parseWorkbookFile(csvFile(csv));
    const sheet = result.sheets[0];
    expect(sheet.droppedBlankRows).toBe(0);
    expect(sheet.excelFirstDataRow).toBe(2);
    expect(sheet.excelLastRow).toBe(4); // header row 1 + 3 data rows
    expect(excelRowExtent(sheet).needsNote).toBe(false);
  });

  it("counts blank rows dropped from inside the data and extends the range past rows.length+1", async () => {
    const csv = "A,B\n1,x\n,\n2,y\n,\n,\n3,z\n";
    const result = await parseWorkbookFile(csvFile(csv));
    const sheet = result.sheets[0];
    expect(sheet.rows).toHaveLength(3); // only the 3 real rows
    expect(sheet.droppedBlankRows).toBe(3); // the 3 blank rows in between
    const extent = excelRowExtent(sheet);
    expect(extent.needsNote).toBe(true);
    // Physical extent covers all 6 data-area rows (3 real + 3 blank), not
    // just rows.length+1 (which would wrongly be 4).
    expect(extent.lastRow).toBe(7); // header row 1 + 6 physical rows
    expect(extent.lastRow).not.toBe(sheet.rows.length + 1);
  });
});

describe("P1-9 — excelRowExtent / excelRowExtentNote", () => {
  it("falls back to the tidy default for a sheet with no recorded extent (e.g. deriveSheet)", () => {
    const sheet = deriveSheet("Cleaned", [{ A: 1 }, { A: 2 }]);
    const extent = excelRowExtent(sheet);
    expect(extent).toEqual({ firstDataRow: 2, lastRow: 3, droppedBlankRows: 0, needsNote: false });
  });

  it("the note mentions both a non-row-1 header and dropped blank rows when both apply", () => {
    const sheet = { rows: [{ A: 1 }], excelFirstDataRow: 5, excelLastRow: 10, droppedBlankRows: 2 };
    const note = excelRowExtentNote(excelRowExtent(sheet));
    expect(note).toMatch(/header is in row 4/i);
    expect(note).toMatch(/2 blank rows/i);
    expect(note).toMatch(/row 10/);
  });
});

describe("P1-9 — buildFixPlan's Excel steps carry the honesty note when needed", () => {
  it("prepends the note to the first Excel step for a sheet with dropped blank rows", async () => {
    const csv = "A,B\n1,x\n,\n2,y\n";
    const result = await parseWorkbookFile(csvFile(csv));
    const sheet = result.sheets[0];
    const fixes = [{ normalizer: "coerceNumbers", column: "A", params: {} }];
    const { plan } = buildFixPlan(sheet, fixes);
    expect(plan.excel_steps[0].instruction).toMatch(/isn't perfectly tidy/i);
    expect(plan.excel_steps[0].instruction).toMatch(/1 blank row/i);
  });

  it("adds no note for an ordinary tidy sheet", () => {
    const sheet = deriveSheet("Patients", [{ Dose: "$1,200" }, { Dose: "250" }]);
    const fixes = [{ normalizer: "coerceNumbers", column: "Dose", params: {} }];
    const { plan } = buildFixPlan(sheet, fixes);
    expect(plan.excel_steps[0].instruction).not.toMatch(/isn't perfectly tidy/i);
  });
});
