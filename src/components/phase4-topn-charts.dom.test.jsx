// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// Phase 4 (2026-07-10): the Step 9 mirror of the Q&A most-common/top-N
// ranking family — "top N Y" caps the bar chart at N, sorted descending
// (existing default), same as the ranked table Step 3 shows.

function drugSheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Drug: "cephalexin" },
    { PatientID: "P2", Drug: "cephalexin" },
    { PatientID: "P3", Drug: "cephalexin" },
    { PatientID: "P4", Drug: "amoxicillin" },
    { PatientID: "P5", Drug: "amoxicillin" },
    { PatientID: "P6", Drug: "cefpodoxime" },
  ]);
}

describe("Phase 4 (DOM) — 'top N' caps the chart", () => {
  it("'top 2 drug' draws only the top 2 bars, largest first", () => {
    const { container } = render(<ChartsPanel sheet={drugSheet()} />);
    fireEvent.change(screen.getByPlaceholderText(/organisms in urine/i), { target: { value: "top 2 drug" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));

    const img = screen.getByRole("img", { name: /bar chart/i });
    expect(container.querySelectorAll("rect").length).toBe(2);
    expect(img.textContent).toMatch(/cephalexin/);
    expect(img.textContent).not.toMatch(/cefpodoxime/);
  });

  it("re-picking the label column by hand afterwards clears the earlier cap", () => {
    const { container } = render(<ChartsPanel sheet={drugSheet()} />);
    fireEvent.change(screen.getByPlaceholderText(/organisms in urine/i), { target: { value: "top 1 drug" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));
    expect(container.querySelectorAll("rect").length).toBe(1);

    const labelSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(labelSelect, { target: { value: "" } });
    fireEvent.change(labelSelect, { target: { value: "Drug" } });
    // Back to all 3 drugs — the earlier "top 1" cap no longer applies.
    expect(container.querySelectorAll("rect").length).toBe(3);
  });
});
