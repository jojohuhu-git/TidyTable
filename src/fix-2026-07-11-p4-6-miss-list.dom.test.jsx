// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// P4-6 (fix-2026-07-11-steps-2-3-9-plain-english.md): missLog/hitStore already
// recorded every miss locally, but there was no UI to see them. A small
// "Questions I couldn't answer this session" list turns real usage into a
// teaching queue. Scoped to THIS session only (a persistent, multi-session
// store shouldn't dredge up old, already-handled misses).

vi.mock("./logic/runTransform.js", () => ({
  runTransform: vi.fn(async (code, sheetsByName) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", code);
    return fn(sheetsByName);
  }),
}));

const { default: App } = await import("./App.jsx");

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

describe("P4-6 — 'Questions I couldn't answer this session'", () => {
  it("a declined question appears in the list with the same honest message shown in the notice", async () => {
    await upload();
    ask("average diagnosis");
    await waitFor(() => expect(screen.getByText(/Questions I couldn't answer this session/i)).toBeTruthy());
    const section = screen.getByText(/Questions I couldn't answer this session/i).closest("section");
    expect(section.textContent).toMatch(/average diagnosis/);
    expect(section.textContent).toMatch(/words, not numbers/i);
  });

  it("a confidently answered question never appears in the list", async () => {
    await upload();
    ask("how many rows have cephalexin");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(screen.queryByText(/Questions I couldn't answer this session/i)).toBeNull();
  });

  it("does not show a miss recorded before this page load (a stale entry from an earlier session)", async () => {
    localStorage.setItem("tidytable_misses", JSON.stringify([
      { request: "some old unanswerable request", reason: "none", message: "an old refusal", at: "2020-01-01T00:00:00.000Z" },
    ]));
    await upload();
    ask("average diagnosis");
    await waitFor(() => expect(screen.getByText(/Questions I couldn't answer this session/i)).toBeTruthy());
    expect(screen.queryByText(/some old unanswerable request/i)).toBeNull();
  });
});
