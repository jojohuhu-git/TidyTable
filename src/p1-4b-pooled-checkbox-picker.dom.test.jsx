// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("./logic/runTransform.js", () => ({
  runTransform: vi.fn(async (code, sheetsByName) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", code);
    return fn(sheetsByName);
  }),
}));

const { default: App } = await import("./App.jsx");

// P1-4b: the no-typing counterpart to P1-4a. Tick 2+ columns and press a
// button instead of phrasing "most common value across X and Y" — it must
// ride the exact same pipeline P1-4a already built (clarify, memory, result),
// and must warn/block on a column Step 2 flags as packed (multiValue), since
// rankFrequencyPooled counts a packed cell as one atomic value, not several.

function cleanFile() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Diagnosis", "Drug"],
    ["P1", "UTI", "cephalexin"],
    ["P2", "pneumonia", "amoxicillin"],
    ["P3", "UTI", "amoxicillin"],
    ["P4", "cystitis", "cephalexin"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Encounters");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "clinic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function packedFile() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Diagnosis", "Symptoms"],
    ["P1", "UTI", "fever, chills"],
    ["P2", "pneumonia", "cough, fever"],
    ["P3", "UTI", "dysuria"],
    ["P4", "cystitis", "fever"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Encounters");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "clinic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function upload(fileFn) {
  render(<App />);
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [fileFn()] } });
  await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
}

function pickerCheckbox(name) {
  const picker = document.querySelector(".pooled-rank-picker");
  const label = Array.from(picker.querySelectorAll(".col-chip")).find((l) => l.textContent.startsWith(name));
  return label.querySelector('input[type="checkbox"]');
}

beforeEach(() => localStorage.clear());

describe("P1-4b (DOM) — no-typing pooled-rank checkbox picker", () => {
  it("stays disabled with 0 or 1 columns picked, runs the pooled pipeline once 2+ are picked", async () => {
    await upload(cleanFile);

    const runBtn = screen.getByRole("button", { name: /rank combined columns/i });
    expect(runBtn.disabled).toBe(true);

    fireEvent.click(pickerCheckbox("Diagnosis"));
    expect(runBtn.disabled).toBe(true); // still just 1

    fireEvent.click(pickerCheckbox("Drug"));
    expect(runBtn.disabled).toBe(false);

    fireEvent.click(runBtn);

    // Same gate P1-4a's typed path hits: the counting-policy question, never
    // a silent default.
    await waitFor(() => expect(document.querySelector(".clarify-q")).toBeTruthy());
    expect(screen.getByText(/how should it be counted/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /every occurrence/i }));
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(document.body.textContent).toMatch(/most common value across Diagnosis and Drug/i);
  });

  it("warns and blocks the run when a picked column is a Step 2 packed-cell (multiValue) finding", async () => {
    await upload(packedFile);

    fireEvent.click(pickerCheckbox("Diagnosis"));
    fireEvent.click(pickerCheckbox("Symptoms"));

    const picker = document.querySelector(".pooled-rank-picker");
    expect(picker.textContent).toMatch(/split it in Step 2 first/i);
    const runBtn = screen.getByRole("button", { name: /rank combined columns/i });
    expect(runBtn.disabled).toBe(true);
  });
});
