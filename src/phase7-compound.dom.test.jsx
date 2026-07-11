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

// Phase 7.4 (plan-2026-07-10-offline-smarts.md), user-visible layer: a compound
// "and" question answers each part and shows one combined card; a value set
// joined by "and" is NOT split.

function file() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Diagnosis", "Drug", "Duration_days"],
    ["P1", "UTI", "cephalexin", 10],
    ["P2", "pneumonia", "amoxicillin", 7],
    ["P3", "UTI", "amoxicillin", 5],
    ["P4", "UTI", "cephalexin", 8],
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

describe("Phase 7.4 (DOM) — compound questions answered as one combined card", () => {
  it("answers both parts of 'average duration and most common drug'", async () => {
    await upload();
    ask("average duration and most common drug");
    await waitFor(() => expect(screen.getByText(/Answering 2 things at once/i)).toBeTruthy());
    // Both sub-answers appear in the stacked parts (each has its own summary).
    expect(document.querySelectorAll(".compound-part").length).toBe(2);
    expect(screen.getAllByText(/Averaging "Duration_days"/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ranking "Drug" by how/i).length).toBeGreaterThan(0);
  });

  it("does NOT split a value set — 'amoxicillin and cephalexin' stays one question", async () => {
    await upload();
    ask("how many records with amoxicillin and cephalexin");
    // No combined card; the normal engine handles it (answer or ask), never a
    // 2-part split.
    await waitFor(() =>
      expect(
        screen.queryByText(/Answering 2 things at once/i) === null
        && (document.querySelector(".result-card") || document.querySelector(".clarify-q")),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/Answering 2 things at once/i)).toBeNull();
  });
});
