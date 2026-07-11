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

// Phase 7.3 (plan-2026-07-10-offline-smarts.md), user-visible layer: "more than
// a week" answers as > 7 days and the trust line states the conversion.

function file() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Duration_days"],
    ["P1", 3], ["P2", 7], ["P3", 10], ["P4", 14], ["P5", 40],
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

describe("Phase 7.3 (DOM) — a spoken duration converts and says so", () => {
  it("'more than a week' answers and the trust line states 1 week = 7 days", async () => {
    await upload();
    ask("how many records with duration_days more than a week");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(screen.getAllByText(/over 7 \(from "1 week = 7 days"\)/i).length).toBeGreaterThan(0);
  });
});
