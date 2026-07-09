// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App.jsx";

// P1-10: the offline engine and Steps 7-10 silently use only the first sheet.
// The checkup step already said so; Steps 7-9 (and the Reshape step's base
// side) did not — a user with the relevant data on sheet 2 had no warning
// they were about to look at the wrong sheet. This is the "minimum honest
// version" from the audit: no sheet selector, just an honest sentence.
function twoSheetXlsxFile() {
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([["Diagnosis"], ["UTI"], ["pneumonia"]]);
  const ws2 = XLSX.utils.aoa_to_sheet([["Prescriber"], ["Dr. A"]]);
  XLSX.utils.book_append_sheet(wb, ws1, "Encounters");
  XLSX.utils.book_append_sheet(wb, ws2, "Roster");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "two-sheets.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function oneSheetXlsxFile() {
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([["Diagnosis"], ["UTI"], ["pneumonia"]]);
  XLSX.utils.book_append_sheet(wb, ws1, "Encounters");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "one-sheet.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function uploadAndOpenAnalyzeGroup(file) {
  render(<App />);
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());
  const summary = screen.getByText(/Analyze & chart/i);
  fireEvent.click(summary);
}

describe("P1-10 — Steps 7-10 disclose when only the first sheet is in play", () => {
  it("names the first sheet in Steps 7-9 when the workbook has more than one sheet", async () => {
    await uploadAndOpenAnalyzeGroup(twoSheetXlsxFile());
    const notes = screen.getAllByText(/Only the first sheet, "Encounters", is used here\./i);
    expect(notes.length).toBe(3); // Steps 7, 8, 9
  });

  it("names the first sheet as the reshape starting point when there are multiple sheets", async () => {
    await uploadAndOpenAnalyzeGroup(twoSheetXlsxFile());
    const reshapeSummary = screen.getByText(/Reshape —/i);
    fireEvent.click(reshapeSummary);
    expect(screen.getByText(/The first sheet, "Encounters", is always the starting point/i)).toBeTruthy();
  });

  it("says nothing extra for a single-sheet workbook", async () => {
    await uploadAndOpenAnalyzeGroup(oneSheetXlsxFile());
    expect(screen.queryByText(/Only the first sheet/i)).toBeNull();
  });
});
