// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P5-2: the purpose-sized export chooser in Step 9 — plain-word presets, a
// poster width input that only shows when it applies, a "?" note that
// explains the sizes without jargon in the labels, and the live legibility
// warning when the chosen size would print the chart's small text under
// ~8pt.

function sheet() {
  return deriveSheet("D", [{ Dx: "UTI" }, { Dx: "UTI" }, { Dx: "pneumonia" }]);
}

function setup() {
  render(<ChartsPanel sheet={sheet()} />);
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Dx" } });
}

function presetSelect() {
  return screen.getByLabelText(/download size/i);
}

describe("P5-2 — export size chooser", () => {
  it("offers the four presets in plain words next to the PNG download", () => {
    setup();
    const sel = presetSelect();
    const labels = [...sel.querySelectorAll("option")].map((o) => o.textContent);
    expect(labels.some((l) => /slide/i.test(l))).toBe(true);
    expect(labels.some((l) => /poster/i.test(l))).toBe(true);
    expect(labels.some((l) => /single column/i.test(l))).toBe(true);
    expect(labels.some((l) => /double column/i.test(l))).toBe(true);
    expect(screen.getByRole("button", { name: /download chart as image/i })).toBeTruthy();
  });

  it("shows the poster width input only when the poster preset is chosen", () => {
    setup();
    expect(screen.queryByLabelText(/inches wide/i)).toBeNull();
    fireEvent.change(presetSelect(), { target: { value: "poster" } });
    const inches = screen.getByLabelText(/inches wide/i);
    expect(inches.value).toBe("8");
  });

  it("warns when the single-column size would print the small text under ~8pt", () => {
    setup();
    fireEvent.change(presetSelect(), { target: { value: "col1" } });
    expect(screen.getByText(/hard to read|smaller than/i)).toBeTruthy();
    fireEvent.change(presetSelect(), { target: { value: "col2" } });
    expect(screen.queryByText(/hard to read|smaller than/i)).toBeNull();
  });

  it("has a plain-English 'what do these sizes mean' note", () => {
    setup();
    fireEvent.click(screen.getByText(/what do these sizes mean/i));
    expect(screen.getByText(/print quality/i)).toBeTruthy();
  });
});
