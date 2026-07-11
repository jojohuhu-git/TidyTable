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

// Phase 7.6 (plan-2026-07-10-offline-smarts.md), user-visible layer: the n (%)
// companion states the denominator in words and notes blanks in the filter
// column.

function file() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Drug"],
    ["P1", "cephalexin"], ["P2", ""], ["P3", "amoxicillin"], ["P4", "cephalexin"], ["P5", ""],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Encounters");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "clinic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function upload() {
  render(<App />);
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file()] } });
  await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
}

function ask(question) {
  const box = document.querySelector(".prompt-box");
  fireEvent.change(box, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
}

beforeEach(() => localStorage.clear());

describe("Phase 7.6 (DOM) — denominator + missing transparency", () => {
  it("the 'as n (%)' companion states the denominator and blank count in words", async () => {
    await upload();
    ask("how many rows with cephalexin");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /as n \(%\)/i }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/2 \(40%\) of 5 rows; 2 of them blank in "Drug"/),
    );
  });
});
