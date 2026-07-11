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

// Phase 7.2 (plan-2026-07-10-offline-smarts.md), user-visible layer: a misspelled
// value asks "Did you mean amoxicillin?" (a confirm chip), never auto-answers;
// accepting the chip then produces the answer.

function file() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Drug"],
    ["P1", "amoxicillin"],
    ["P2", "cephalexin"],
    ["P3", "amoxicillin"],
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

// The suggested-spelling chip lives inside the clarify box (class clarify-opt) —
// scope to it so the unrelated example-prompt chips (which also mention drugs)
// don't confuse the query.
function clarifyChip(re) {
  return [...document.querySelectorAll("button.clarify-opt")].find((b) => re.test(b.textContent));
}

beforeEach(() => localStorage.clear());

describe("Phase 7.2 (DOM) — typo tolerance asks, then answers on confirm", () => {
  it("a misspelled drug shows a confirm chip and no answer yet", async () => {
    await upload();
    ask("how many records with amoxicilin");
    await waitFor(() => expect(document.querySelector(".clarify-q")).toBeTruthy());
    expect(clarifyChip(/amoxicillin/i)).toBeTruthy();
    expect(screen.queryByText(/Result of: your question/i)).toBeNull();
  });

  it("clicking the suggested spelling produces the answer", async () => {
    await upload();
    ask("how many records with amoxicilin");
    await waitFor(() => expect(clarifyChip(/amoxicillin/i)).toBeTruthy());
    fireEvent.click(clarifyChip(/amoxicillin/i));
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(screen.getAllByText(/"Drug" is amoxicillin/i).length).toBeGreaterThan(0);
  });
});
