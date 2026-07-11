// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { listMisses, formatMisses } from "./logic/offline/missLog.js";

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

// Phase 5 (plan-2026-07-10-offline-smarts.md), user-visible layer: the confirm
// box now has a real "None of these" that pages to a smarter next question,
// confirms a later-round pick (persisting the alias), and — when every guess is
// rejected — stops honestly and offers the AI instead of guessing.

// Four numeric duration-ish columns, so an everyday phrase resolves to more
// candidates than one round can show (round 1 shows 3, one pages to round 2).
function fourDurationFile() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Duration_days", "Therapy_days", "Course_days", "Stay_days"],
    ["P1", 10, 8, 6, 4],
    ["P2", 7, 5, 3, 2],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Encounters");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "clinic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function upload() {
  render(<App />);
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [fourDurationFile()] } });
  await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
}

function ask(question) {
  const box = document.querySelector(".prompt-box");
  fireEvent.change(box, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
}

const noneBtn = () => screen.getByRole("button", { name: /None of these/i });

beforeEach(() => {
  localStorage.clear();
});

describe("Phase 5 (DOM) — 'None of these' pages to a smarter next round", () => {
  it("clicking 'None of these' swaps in a new question, no answer, no decline", async () => {
    await upload();
    ask("average treatment length");
    await waitFor(() => expect(document.querySelector(".clarify-q")).toBeTruthy());
    const firstQ = document.querySelector(".clarify-q").textContent;
    // Round 1 has real chips plus the escape.
    expect(noneBtn()).toBeTruthy();
    expect(screen.queryByText(/Result of: your question/i)).toBeNull();

    fireEvent.click(noneBtn());
    // A new round renders (still a confirm box, still no answer, no decline notice).
    await waitFor(() => expect(document.querySelector(".clarify-q")).toBeTruthy());
    expect(screen.queryByText(/Result of: your question/i)).toBeNull();
    // The paged-out candidate (Duration_days) is now on offer.
    expect(screen.getByRole("button", { name: /Duration_days.*column/i })).toBeTruthy();
    void firstQ;
  });

  it("confirming a round-2 candidate answers AND persists the column alias", async () => {
    await upload();
    ask("average treatment length");
    await waitFor(() => expect(noneBtn()).toBeTruthy());
    fireEvent.click(noneBtn());
    await waitFor(() => expect(screen.getByRole("button", { name: /Duration_days.*column/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Duration_days.*column/i }));
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());

    // Re-asking the same phrase now answers straight away — the alias stuck.
    ask("average treatment length");
    await waitFor(() =>
      expect(screen.getAllByText(/Result of: your question/i).length).toBeGreaterThanOrEqual(2),
    );
    expect(document.querySelector(".clarify-q")).toBeNull();
    const stored = localStorage.getItem("tidytable_column_aliases");
    expect(stored).toContain("Duration_days");
  });

  it("rejecting every round stops honestly (no answer) and logs the exchange", async () => {
    await upload();
    ask("average treatment length");
    await waitFor(() => expect(noneBtn()).toBeTruthy());
    fireEvent.click(noneBtn()); // reject round 1 → round 2 (Duration_days)
    await waitFor(() => expect(screen.getByRole("button", { name: /Duration_days.*column/i })).toBeTruthy());
    fireEvent.click(noneBtn()); // reject round 2 → exhausted

    // With no API key: the honest-stop notice appears, no answer card.
    await waitFor(() => expect(screen.getByText(/every guess I had/i)).toBeTruthy());
    expect(screen.queryByText(/Result of: your question/i)).toBeNull();
    expect(document.querySelector(".clarify-q")).toBeNull();

    // The exhausted exchange is logged with its round count.
    const misses = listMisses();
    expect(misses.some((m) => m.reason === "refined-exhausted")).toBe(true);
    expect(formatMisses()).toMatch(/refined-exhausted, 2 rounds/);
  });

  it("a >1-round success shows up in the miss-log export with its round count", async () => {
    await upload();
    ask("average treatment length");
    await waitFor(() => expect(noneBtn()).toBeTruthy());
    fireEvent.click(noneBtn());
    await waitFor(() => expect(screen.getByRole("button", { name: /Duration_days.*column/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Duration_days.*column/i }));
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());

    expect(formatMisses()).toMatch(/refined-success, 2 rounds/);
  });
});
