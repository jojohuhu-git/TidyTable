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

// Phase 4 (plan-2026-07-10-offline-smarts.md), user-visible layer: the
// most-common/top-N ranking family answers offline with a ranked result
// table, and a genuinely non-numeric "longest" ask still declines in plain
// English rather than silently ranking text.

function clinicFile() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Diagnosis", "Drug", "Duration_days"],
    ["P1", "UTI", "cephalexin", 10],
    ["P2", "UTI", "amoxicillin", 6],
    ["P3", "pneumonia", "amoxicillin", 5],
    ["P4", "cystitis", "cephalexin", 3],
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

describe("Phase 4 (DOM) — most/least common ranks as a table", () => {
  it("'most common diagnosis' answers offline with a ranked n (%) table", async () => {
    await upload();
    ask("most common diagnosis");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    const text = document.body.textContent;
    expect(text).toMatch(/most common first/);
    expect(text).toMatch(/UTI/);
    expect(text).toMatch(/50%/); // UTI: 2 of 4 rows
  });
});

describe("Phase 4 (DOM) — longest/shortest ranks raw rows", () => {
  it("'longest duration_days' answers with the top row's own columns", async () => {
    await upload();
    ask("longest duration_days");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    const text = document.body.textContent;
    expect(text).toMatch(/largest first/);
    expect(text).toMatch(/P1/);
    expect(text).toMatch(/cephalexin/);
  });
});

describe("Phase 4 (DOM) — non-numeric magnitude ask still declines in plain English", () => {
  it("'longest diagnosis' shows the words-not-numbers message, no answer card", async () => {
    await upload();
    ask("longest diagnosis");
    await waitFor(() => expect(document.body.textContent).toMatch(/contains words, not numbers/));
    expect(screen.queryByText(/Result of: your question/i)).toBeNull();
  });
});
