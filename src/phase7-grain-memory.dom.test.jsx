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

// Phase 7.7 (plan-2026-07-10-offline-smarts.md), user-visible layer: the
// per-patient/per-row grain is asked ONCE, then remembered — a later question
// applies it with a small "change" note instead of asking again.

function file() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Diagnosis"],
    ["P1", "UTI"], ["P1", "UTI"], ["P2", "pneumonia"], ["P3", "UTI"],
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

describe("Phase 7.7 (DOM) — grain memory: ask once, then remember", () => {
  it("asks the first time, applies the choice (with a Change note) the next time", async () => {
    await upload();

    // First per-patient question → the grain clarify appears.
    ask("how many patients with UTI");
    await waitFor(() => expect(document.querySelector(".clarify-q")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Combine each patient's rows first/i }));
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(screen.queryByText(/counting per .*change/i)).toBeNull(); // no note on the ask turn

    // Second per-patient question → NO clarify; the remembered choice applies
    // and the "change" note shows.
    ask("how many patients with pneumonia");
    await waitFor(() => expect(document.querySelector(".grain-note")).toBeTruthy());
    expect(document.querySelector(".clarify-q")).toBeNull();
    expect(screen.getByRole("button", { name: /^Change$/i })).toBeTruthy();
  });

  it("'Change' forgets the choice and re-asks", async () => {
    await upload();
    ask("how many patients with UTI");
    await waitFor(() => expect(document.querySelector(".clarify-q")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Count rows as they are/i }));
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());

    ask("how many patients with pneumonia");
    await waitFor(() => expect(document.querySelector(".grain-note")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Change$/i }));
    // The grain question comes back.
    await waitFor(() => expect(document.querySelector(".clarify-q")).toBeTruthy());
    expect(document.querySelector(".grain-note")).toBeNull();
  });
});
