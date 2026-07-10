// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChartsPanel from "./components/ChartsPanel.jsx";
import { deriveSheet } from "./logic/workbook.js";

// happy-dom has no real Worker; run the generated transform synchronously so
// an offline answer actually completes (same shim as the other DOM tests).
vi.mock("./logic/runTransform.js", () => ({
  runTransform: vi.fn(async (code, sheetsByName) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", code);
    return fn(sheetsByName);
  }),
}));

const { default: App } = await import("./App.jsx");

// Phase 1 honesty bugs, user-visible layer: the refusal, the negated answer,
// and the chart confirm must each reach the screen — not just the engine.

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

async function upload(file) {
  render(<App />);
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
}

function ask(question) {
  const box = document.querySelector(".prompt-box");
  fireEvent.change(box, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
}

describe("Bug 1 (DOM) — averaging a text column shows a plain refusal", () => {
  it('says "words, not numbers" instead of answering', async () => {
    await upload(clinicFile());
    ask("average diagnosis");
    await waitFor(() => expect(screen.getByText(/words, not numbers/i)).toBeTruthy());
    expect(screen.queryByText(/Result of: your question/i)).toBeNull();
  });
});

describe("Bug 3 (DOM) — a negated question answers the NOT question, visibly", () => {
  it('"did not get amoxicillin" answers 2 of 4 and states the negation', async () => {
    await upload(clinicFile());
    ask("how many rows did not get amoxicillin");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    // Expand the result card (unless it opened itself on record): the trust
    // line spells the negation back.
    const toggle = document.querySelector(".result-card-toggle");
    if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
    await waitFor(() => expect(document.body.textContent).toMatch(/"Drug" is NOT amoxicillin/));
  });
});

describe("Bug 2 (DOM) — chart free text confirms the flip before drawing", () => {
  it('"duration by diagnosis" asks about the average instead of silently counting', () => {
    const sheet = deriveSheet("Encounters", [
      { PatientID: "P1", Diagnosis: "UTI", Duration_days: 5 },
      { PatientID: "P2", Diagnosis: "pneumonia", Duration_days: 7 },
      { PatientID: "P3", Diagnosis: "UTI", Duration_days: 10 },
    ]);
    render(<ChartsPanel sheet={sheet} />);
    fireEvent.change(screen.getByPlaceholderText(/organisms in urine/i), { target: { value: "duration by diagnosis" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));

    // A confirm box names the flipped read; nothing is drawn yet.
    expect(screen.getByText(/Did you mean/i)).toBeTruthy();
    expect(document.querySelector(".clarify-q").textContent).toMatch(/average of "Duration_days"/i);
    expect(screen.queryByRole("img")).toBeNull();

    // Confirming draws the average chart.
    fireEvent.click(screen.getByRole("button", { name: /Yes, chart that/i }));
    expect(screen.getByRole("img", { name: /bar chart/i })).toBeTruthy();
  });
});
