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

// Phase 7.1 (plan-2026-07-10-offline-smarts.md), user-visible layer: after an
// answer, a short follow-up reuses the previous question — "of those, …" carries
// the cohort, "what about X" swaps one value — with no re-typing.

function file() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Diagnosis", "Drug"],
    ["P1", "UTI", "cephalexin"],
    ["P2", "pneumonia", "amoxicillin"],
    ["P3", "UTI", "amoxicillin"],
    ["P4", "UTI", "cephalexin"],
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

describe("Phase 7.1 (DOM) — follow-up questions remember the last answer", () => {
  it("'of those, …' carries the previous cohort into the next answer", async () => {
    await upload();
    ask("how many records with UTI");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());

    ask("of those, how many got cephalexin");
    // The trust line spells back BOTH filters — cohort carried over, not lost.
    await waitFor(() =>
      expect(screen.getAllByText(/"Diagnosis" is uti.*"Drug" is cephalexin/i).length).toBeGreaterThan(0),
    );
  });

  it("'what about X' re-runs the last question with one value swapped", async () => {
    await upload();
    ask("how many records with amoxicillin");
    await waitFor(() => expect(screen.getAllByText(/"Drug" is amoxicillin/i).length).toBeGreaterThan(0));

    ask("what about cephalexin");
    // The swapped value now drives the newest answer; the trust line reads
    // cephalexin, not amoxicillin.
    await waitFor(() =>
      expect(screen.getAllByText(/Counting rows where "Drug" is cephalexin/i).length).toBeGreaterThan(0),
    );
  });
});
