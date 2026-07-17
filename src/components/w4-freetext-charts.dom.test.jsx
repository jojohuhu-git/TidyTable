// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// W4: describe the chart in words and the app designs it, confirming only when
// it had to stretch; a ~40-category request draws a horizontal all-rows SVG.

function clinicalSheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", "Urine Organisms": "ESCHERICHIA COLI", Ward: "ICU" },
    { PatientID: "P2", "Urine Organisms": "KLEBSIELLA PNEUMONIAE", Ward: "General" },
    { PatientID: "P3", "Urine Organisms": "ESCHERICHIA COLI", Ward: "General" },
    { PatientID: "P4", "Urine Organisms": "PSEUDOMONAS AERUGINOSA", Ward: "ICU" },
  ]);
}

describe("W4 — free-text chart box", () => {
  it("resolves an exact request immediately and reflects it in the dropdowns", () => {
    render(<ChartsPanel sheet={clinicalSheet()} />);
    const box = screen.getByPlaceholderText(/organisms in urine/i);
    fireEvent.change(box, { target: { value: "organisms in urine by number of patients" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));

    // The chart renders, and the label dropdown now shows the resolved column.
    expect(screen.getByRole("img", { name: /bar chart/i })).toBeTruthy();
    const labelSelect = screen.getAllByRole("combobox")[0];
    expect(labelSelect.value).toBe("Urine Organisms");
  });

  it("confirms with a 'Did you mean' box when it had to stretch (an abbreviation)", () => {
    render(<ChartsPanel sheet={clinicalSheet()} />);
    fireEvent.change(screen.getByPlaceholderText(/organisms in urine/i), { target: { value: "e coli by ward" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));

    // A middle-path confirmation appears rather than silently drawing.
    expect(screen.getByText(/Did you mean/i)).toBeTruthy();
    // Confirming draws the chart, scoped to the E. coli filter.
    fireEvent.click(screen.getByRole("button", { name: /Yes, chart that/i }));
    expect(screen.getByRole("img", { name: /bar chart/i })).toBeTruthy();
    expect(screen.getByText(/Only counting rows where "Urine Organisms" is "ESCHERICHIA COLI"/i)).toBeTruthy();
  });

  it("says so plainly when it cannot place the request, without guessing", () => {
    render(<ChartsPanel sheet={clinicalSheet()} />);
    fireEvent.change(screen.getByPlaceholderText(/organisms in urine/i), { target: { value: "zzzz nothing here at all" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));
    expect(screen.getByText(/couldn't tell which column/i)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws a horizontal all-rows SVG with readable labels for ~40 categories", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ Organism: `Organism ${i}`, Cost: i + 1 }));
    const { container } = render(<ChartsPanel sheet={deriveSheet("D", rows)} />);
    fireEvent.change(screen.getByPlaceholderText(/organisms in urine/i), { target: { value: "total cost by organism" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));

    const img = screen.getByRole("img", { name: /bar chart/i });
    // Every category drawn (one rect each) and the canvas grew tall to fit.
    expect(container.querySelectorAll("rect").length).toBe(40);
    expect(Number(img.getAttribute("height"))).toBeGreaterThan(300);
    // Labels are real text, not hidden — the biggest (Organism 39) is present
    // as an axis label. Scoped to .chart-label (not a plain getByText) because
    // P3-3's automatic "Highest total: Organism 39 (40)" subtitle now also
    // names it, which would otherwise match twice.
    const axisLabels = [...container.querySelectorAll(".chart-label")].map((el) => el.textContent);
    expect(axisLabels).toContain("Organism 39");
  });
});
