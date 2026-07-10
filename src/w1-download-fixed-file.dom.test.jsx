// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as workbook from "./logic/workbook.js";

// happy-dom has no real Worker, so — like the b8/b11 DOM tests — mock the
// transform runner directly instead of relying on a real Worker executing
// the generated transform_code. The Duplicate-rows fix just needs to resolve
// to the deduplicated rows (the example workbook's P4 row appears twice).
vi.mock("./logic/runTransform.js", () => ({
  runTransform: vi.fn().mockResolvedValue([
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: "10", Visit_date: "2024-01-05", Lab_value: "12.4" },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 7, Visit_date: "1/9/2024", Lab_value: "<0.5" },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: "5", Visit_date: "2024-01-12", Lab_value: "9.8" },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: "N/A", Visit_date: "2024-02-01", Lab_value: "N/A" },
    { PatientID: "P5", Diagnosis: "pneumonia", Drug: "cefpodoxime", Duration_days: 5, Visit_date: "2024-02-14", Lab_value: "15.1" },
  ]),
}));

const { default: App } = await import("./App.jsx");

// W1: after at least one checkup fix is applied, a primary "Download your fixed
// file (.xlsx)" button appears inside the Step 2 card and downloads the whole
// workbook under "<original name> (cleaned).xlsx". Before any fix it is absent.
describe("W1 — Step 2 download-fixed-file button", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is absent before any fix and present, with the right filename, after applying one", async () => {
    // Don't actually write a file in the test environment; capture the call.
    const spy = vi.spyOn(workbook, "downloadWorkbookAsXlsx").mockImplementation(() => {});

    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    // Before applying anything, no download-fixed-file button.
    expect(screen.queryByRole("button", { name: /download your fixed file/i })).toBeNull();

    // Tick the no-policy "Duplicate rows" finding and apply it.
    const dupRow = screen.getByText(/Duplicate rows/i).closest(".finding");
    fireEvent.click(dupRow.querySelector('input[type="checkbox"]'));
    fireEvent.click(screen.getByRole("button", { name: /apply .*selected fix/i }));

    // The button now appears with the plain-English copy line.
    const btn = await screen.findByRole("button", { name: /download your fixed file/i });
    expect(btn).toBeTruthy();
    expect(screen.getByText(/Cell colors and column widths are reset/i)).toBeTruthy();

    // Clicking it downloads under "<original name> (cleaned).xlsx".
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
    const [, fileName] = spy.mock.calls[0];
    // The example workbook's name is "example_data.xlsx (fake data)"; the
    // trailing " (cleaned).xlsx" is appended (a real ".xlsx"/".csv" suffix is
    // stripped first — see fixedFileName / the logic test for that case).
    expect(fileName).toMatch(/ \(cleaned\)\.xlsx$/);
  });
});
