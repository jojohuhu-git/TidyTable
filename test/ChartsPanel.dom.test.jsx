// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartsPanel from "../src/components/ChartsPanel.jsx";
import { deriveSheet } from "../src/logic/workbook.js";

function wardSheet() {
  const rows = [];
  const add = (w, n) => { for (let i = 0; i < n; i++) rows.push({ Ward: w, Drug: "x" }); };
  add("North", 5); add("South", 3); add("East", 2);
  return deriveSheet("D", rows);
}

describe("ChartsPanel recommends and previews a chart", () => {
  it("recommends a bar chart for a few categories and draws an SVG", () => {
    render(<ChartsPanel sheet={wardSheet()} />);
    fireEvent.change(screen.getByRole("combobox", { name: /labels/i }), { target: { value: "Ward" } });
    expect(screen.getByText(/Recommended: bar chart/i)).toBeInTheDocument();
    expect(document.querySelector("svg.chart-svg")).not.toBeNull();
    // Excel reproduction steps appear.
    expect(screen.getByText(/make this chart in excel/i)).toBeInTheDocument();
    expect(screen.getByText(/Insert tab/i)).toBeInTheDocument();
  });

  it("Phase 8.3: labels count bars as n (%) of the cohort", () => {
    render(<ChartsPanel sheet={wardSheet()} />);
    fireEvent.change(screen.getByRole("combobox", { name: /labels/i }), { target: { value: "Ward" } });
    // North 5, South 3, East 2 → total 10 → North's bar reads "5 (50%)".
    const svg = document.querySelector("svg.chart-svg");
    expect(svg.textContent).toMatch(/5 \(50%\)/);
    expect(svg.textContent).toMatch(/3 \(30%\)/);
  });

  it("Phase 8.4: a seed from 'Chart this' auto-fills the box and draws the chart", () => {
    render(<ChartsPanel sheet={wardSheet()} seed={{ request: "patients by ward", nonce: 1 }} />);
    // The request lands in the box and the chart draws without typing.
    expect(screen.getByPlaceholderText(/organisms in urine/i).value).toBe("patients by ward");
    expect(screen.getByText(/Recommended: bar chart/i)).toBeInTheDocument();
    expect(document.querySelector("svg.chart-svg")).not.toBeNull();
  });
});
