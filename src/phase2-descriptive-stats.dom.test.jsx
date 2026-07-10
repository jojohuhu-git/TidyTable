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

// Phase 2 (plan-2026-07-10-offline-smarts.md), user-visible layer: descriptive
// statistics answer in clinical formats, the describe panel renders, and the
// deterministic companion chip ("median (IQR) instead", "as n (%)") appears
// after a stat answer and works with one click.

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

// Duration_days: 5, 7, 10, 3 → sorted 3, 5, 7, 10 → median 6, mean 6.25.

describe("Phase 2 (DOM) — median answers in median (IQR) format", () => {
  it("answers a median question offline with the clinical format in the summary", async () => {
    await upload();
    ask("median duration_days");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(document.body.textContent).toMatch(/6 days \(IQR 4\.5–7\.75\)/);
  });
});

describe("Phase 2 (DOM) — describe panel", () => {
  it('"describe duration_days" renders one panel with n, missing, mean (SD), median (IQR), min–max', async () => {
    await upload();
    ask("describe duration_days");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    const text = document.body.textContent;
    expect(text).toMatch(/Mean \(SD\)/);
    expect(text).toMatch(/Median \(IQR\)/);
    expect(text).toMatch(/Min–Max/);
    expect(text).toMatch(/n = 4, missing = 0/);
  });
});

describe("Phase 2 (DOM) — companion chips", () => {
  it("a mean answer offers the median (IQR) chip; clicking it adds the median result card", async () => {
    await upload();
    ask("average duration_days");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    const chip = screen.getByRole("button", { name: /median \(IQR\) instead/i });
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByText(/median \(IQR\) instead$/i)).toBeTruthy());
    // Two result cards now: the mean and the median companion.
    expect(screen.getAllByText(/Result of: your question/i).length).toBe(2);
    expect(document.body.textContent).toMatch(/6 days \(IQR 4\.5–7\.75\)/);
  });

  it("a count answer offers 'as n (%)'; clicking reveals the formatted line without a new card", async () => {
    await upload();
    ask("how many rows with UTI");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    const chip = screen.getByRole("button", { name: /as n \(%\)/i });
    fireEvent.click(chip);
    await waitFor(() => expect(document.body.textContent).toMatch(/As n \(%\): 2 \(50%\) of 4 rows/));
    expect(screen.getAllByText(/Result of: your question/i).length).toBe(1);
  });

  it("the chip disappears when a new question is asked", async () => {
    await upload();
    ask("average duration_days");
    await waitFor(() => expect(screen.getByRole("button", { name: /median \(IQR\) instead/i })).toBeTruthy());
    ask("how many rows with pneumonia");
    await waitFor(() => expect(screen.queryByRole("button", { name: /median \(IQR\) instead/i })).toBeNull());
  });
});

describe("Phase 2 (DOM) — text column still declines in plain English", () => {
  it("median of a text column shows the words-not-numbers message, no answer card", async () => {
    await upload();
    ask("median Drug");
    await waitFor(() => expect(document.body.textContent).toMatch(/contains words, not numbers/));
    expect(screen.queryByText(/Result of: your question/i)).toBeNull();
  });
});
