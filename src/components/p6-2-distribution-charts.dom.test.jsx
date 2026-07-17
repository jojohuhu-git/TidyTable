// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P6-2: histogram (one numeric column, no grouping) and box+dot plot
// (a numeric column's spread within each group) — UI layer.

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Duration_days: 10 },
    { PatientID: "P2", Diagnosis: "pneumonia", Duration_days: 7 },
    { PatientID: "P3", Diagnosis: "UTI", Duration_days: 5 },
    { PatientID: "P4", Diagnosis: "cystitis", Duration_days: 3 },
    { PatientID: "P5", Diagnosis: "UTI", Duration_days: 6 },
    { PatientID: "P6", Diagnosis: "pneumonia", Duration_days: 8 },
    { PatientID: "P7", Diagnosis: "cystitis", Duration_days: 5 },
    { PatientID: "P8", Diagnosis: "UTI", Duration_days: 4 },
  ]);
}

function selects() {
  return screen.getAllByRole("combobox");
}

describe("P6-2 — hand-picked histogram (Value with no Labels chosen)", () => {
  it("picking a Value column with no Labels column recommends a histogram", () => {
    render(<ChartsPanel sheet={sheet()} />);
    // Value select is index 1; pick "total Duration_days" with no Labels set.
    fireEvent.change(selects()[1], { target: { value: "Duration_days" } });

    expect(screen.getByText(/recommended: histogram/i)).toBeTruthy();
    expect(screen.getByText(/no "labels" column chosen/i)).toBeTruthy();
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/histogram/i);
    // The x-axis title names the column, the y-axis title names what's counted.
    expect(within(img).getAllByText("Duration_days").length).toBeGreaterThan(0);
    expect(within(img).getByText("Number of rows")).toBeTruthy();
  });

  it("Excel steps use Excel's native Histogram chart type and state the bin width", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[1], { target: { value: "Duration_days" } });
    expect(screen.getByText("Insert the histogram")).toBeTruthy();
    expect(screen.getByText("Set the bin width to match the preview")).toBeTruthy();
  });

  it("hides the word-tweak box for a histogram (no tweak verbs apply yet)", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[1], { target: { value: "Duration_days" } });
    expect(screen.queryByPlaceholderText(/only top 5/i)).toBeNull();
  });
});

describe("P6-2 — free text resolves a plain histogram request end to end", () => {
  it('"distribution of Duration_days" fills the Value picker (no Labels) and draws a histogram', () => {
    render(<ChartsPanel sheet={sheet()} />);
    const input = screen.getByPlaceholderText(/organisms in urine/i);
    fireEvent.change(input, { target: { value: "distribution of Duration_days" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));

    expect(screen.getByText(/recommended: histogram/i)).toBeTruthy();
    expect(selects()[0].value).toBe(""); // Labels stays unset
  });
});

describe("P6-2 — box+dot cross-offer from an average-by-group bar", () => {
  it('picking Labels + "average" Value recommends a bar chart and offers box+dot as an alternative', () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[1], { target: { value: "avg::Duration_days" } });

    expect(screen.getByText(/recommended: bar chart/i)).toBeTruthy();
    fireEvent.click(screen.getByText("Other options"));
    expect(screen.getByRole("button", { name: /box and dot plot/i })).toBeTruthy();
  });

  it("clicking the box+dot alternative redraws as a box and dot plot with a legend-free per-group SVG", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[1], { target: { value: "avg::Duration_days" } });
    fireEvent.click(screen.getByText("Other options"));
    fireEvent.click(screen.getByRole("button", { name: /box and dot plot/i }));

    expect(screen.getByText(/recommended: box and dot plot/i)).toBeTruthy();
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/box and dot plot/i);
    expect(img.getAttribute("aria-label")).toMatch(/median/i);
  });

  it("clicking back to the bar alternative from box+dot returns to the average bar", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[1], { target: { value: "avg::Duration_days" } });
    fireEvent.click(screen.getByText("Other options"));
    fireEvent.click(screen.getByRole("button", { name: /box and dot plot/i }));
    expect(screen.getByText(/recommended: box and dot plot/i)).toBeTruthy();

    fireEvent.click(screen.getByText("Other options"));
    fireEvent.click(screen.getByRole("button", { name: /^bar chart$/i }));
    expect(screen.getByText(/recommended: bar chart/i)).toBeTruthy();
  });

  it("a plain count bar chart (no Value column) never offers box+dot", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    expect(screen.getByText(/recommended: bar chart/i)).toBeTruthy();
    if (screen.queryByText("Other options")) {
      fireEvent.click(screen.getByText("Other options"));
      expect(screen.queryByRole("button", { name: /box and dot plot/i })).toBeNull();
    }
  });

  it("Excel steps for box+dot use the native Box and Whisker chart type and note the dots are the app's own addition", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[1], { target: { value: "avg::Duration_days" } });
    fireEvent.click(screen.getByText("Other options"));
    fireEvent.click(screen.getByRole("button", { name: /box and dot plot/i }));

    expect(screen.getByText("Insert the box and whisker chart")).toBeTruthy();
    expect(screen.getByText("About the dots")).toBeTruthy();
  });
});
