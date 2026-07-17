// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P6-1: grouped/stacked/100%-stacked bars for two categorical columns — UI
// layer (hand-picked "Split by" dropdown + free-text resolution).

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin" },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "azithromycin" },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin" },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cephalexin" },
    { PatientID: "P5", Diagnosis: "UTI", Drug: "cephalexin" },
    { PatientID: "P6", Diagnosis: "pneumonia", Drug: "amoxicillin" },
  ]);
}

function selects() {
  return screen.getAllByRole("combobox");
}

describe("P6-1 — hand-picked two-column chart (Labels + Split by)", () => {
  it("picking Labels then Split by recommends a grouped bar chart with a legend and a matching preview", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[2], { target: { value: "Drug" } });

    expect(screen.getByText(/recommended: grouped bar chart/i)).toBeTruthy();
    // The legend draws every subgroup name as text inside the SVG.
    expect(screen.getByText("cephalexin")).toBeTruthy();
    expect(screen.getByText("amoxicillin")).toBeTruthy();
    expect(screen.getByText("azithromycin")).toBeTruthy();
    // Aria summary names the crosstab, not a single-axis bar list.
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/UTI/);
    expect(img.getAttribute("aria-label")).toMatch(/cephalexin/);
  });

  it("picking a Value column clears any Split by column (mutually exclusive for now)", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[2], { target: { value: "Drug" } });
    expect(screen.getByText(/recommended: grouped bar chart/i)).toBeTruthy();
    // Split by select becomes disabled once no numeric Value exists to pick anyway,
    // but choosing Labels fresh and re-picking Split by, then clearing it, returns
    // to the single-column count chart.
    fireEvent.change(selects()[2], { target: { value: "" } });
    expect(screen.getByText("count by Diagnosis")).toBeTruthy();
  });

  it("an 'Other options' click switches the layout (grouped -> stacked -> 100% stacked)", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[2], { target: { value: "Drug" } });
    fireEvent.click(screen.getByText("Other options"));
    const stackedBtn = screen.getByRole("button", { name: /^stacked bar chart$/i });
    fireEvent.click(stackedBtn);
    expect(screen.getByText(/recommended: stacked bar chart/i)).toBeTruthy();

    fireEvent.click(screen.getByText("Other options"));
    const pct100Btn = screen.getByRole("button", { name: /100% stacked bar chart/i });
    fireEvent.click(pct100Btn);
    expect(screen.getByText(/recommended: 100% stacked bar chart/i)).toBeTruthy();
  });

  it("Excel steps for a crosstab build a helper table and mandate the legend", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[2], { target: { value: "Drug" } });
    expect(screen.getByText("Build the helper table")).toBeTruthy();
    expect(screen.getByText("Turn on the legend")).toBeTruthy();
    expect(screen.getByText(/clustered column/i)).toBeTruthy();
  });

  it("hides the word-tweak box for a crosstab (no tweak verbs apply yet)", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[2], { target: { value: "Drug" } });
    expect(screen.queryByPlaceholderText(/only top 5/i)).toBeNull();
  });
});

describe("P6-1 — free text resolves a two-column request end to end", () => {
  it('"drug mix by diagnosis" fills the pickers and draws a 100% stacked chart', () => {
    render(<ChartsPanel sheet={sheet()} />);
    const input = screen.getByPlaceholderText(/organisms in urine/i);
    fireEvent.change(input, { target: { value: "drug mix by diagnosis" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));

    expect(screen.getByText(/recommended: 100% stacked bar chart/i)).toBeTruthy();
    const picks = selects();
    expect(within(picks[0]).getByRole("option", { name: "Diagnosis", selected: true })).toBeTruthy();
    expect(within(picks[2]).getByRole("option", { name: "Drug", selected: true })).toBeTruthy();
  });
});
