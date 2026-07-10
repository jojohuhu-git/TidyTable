// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// happy-dom has no real Worker; run the generated transform synchronously so an
// offline answer actually completes (same shim the other DOM tests use).
vi.mock("./logic/runTransform.js", () => ({
  runTransform: vi.fn(async (code, sheetsByName) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", code);
    return fn(sheetsByName);
  }),
}));

const { default: App } = await import("./App.jsx");

// Phase 3 (plan-2026-07-10-offline-smarts.md), user-visible layer: an everyday
// word the matcher only understands by concept must ASK which column it means
// (never silently answer), and once confirmed it must answer — and remember the
// mapping so it never asks again.

function clinicFile() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Diagnosis", "Drug", "Duration_days"],
    ["P1", "UTI", "amoxicillin", 5],
    ["P2", "pneumonia", "amoxicillin", 7],
    ["P3", "UTI", "cephalexin", 10],
    ["P4", "cystitis", "cefpodoxime", 3],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Encounters");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "clinic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function upload() {
  render(<App />);
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [clinicFile()] } });
  await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
}

function ask(question) {
  const box = document.querySelector(".prompt-box");
  fireEvent.change(box, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
}

beforeEach(() => {
  localStorage.clear();
});

describe("Phase 3 (DOM) — everyday word asks which column, then answers", () => {
  const chip = () => screen.getByRole("button", { name: /Duration_days.*column/i });

  it('"average treatment length" offers a Duration_days column chip, no silent answer', async () => {
    await upload();
    ask("average treatment length");
    // A confirm box asks about the column; nothing has been answered yet.
    await waitFor(() => expect(document.querySelector(".clarify-q")).toBeTruthy());
    expect(document.querySelector(".clarify-q").textContent).toMatch(/which column|Duration_days/i);
    expect(chip()).toBeTruthy();
    expect(screen.queryByText(/Result of: your question/i)).toBeNull();
  });

  it("clicking the column chip answers the question", async () => {
    await upload();
    ask("average treatment length");
    await waitFor(() => expect(chip()).toBeTruthy());
    fireEvent.click(chip());
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
  });

  it("after confirming once, the same wording no longer asks (learned alias persists)", async () => {
    await upload();
    ask("average treatment length");
    await waitFor(() => expect(chip()).toBeTruthy());
    fireEvent.click(chip());
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());

    // Ask the exact same everyday phrase again: it should answer straight away,
    // with no confirm box this time.
    ask("average treatment length");
    await waitFor(() =>
      expect(screen.getAllByText(/Result of: your question/i).length).toBeGreaterThanOrEqual(2),
    );
    expect(document.querySelector(".clarify-q")).toBeNull();

    // And the mapping is persisted (column name only — never a cell value).
    const stored = localStorage.getItem("tidytable_column_aliases");
    expect(stored).toBeTruthy();
    expect(stored).toContain("Duration_days");
    expect(stored).not.toContain("amoxicillin");
  });
});
