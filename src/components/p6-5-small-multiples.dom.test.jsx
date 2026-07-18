// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P6-5: small multiples for a crowded crosstab — UI layer. A grid of mini
// panels (capped at 12) with a shared legend, an honest "…and N more" note,
// and the FULL crosstab as a table below so nothing is hidden for good.

const pad = (n) => String(n).padStart(2, "0");

// Same deterministic fixture as the logic test: 14 categories x 10 drugs,
// weighted so every sort order is tie-free.
function bigRows({ cats = 14, drugs = 10 } = {}) {
  const rows = [];
  for (let c = 1; c <= cats; c++) {
    for (let d = 1; d <= drugs; d++) {
      rows.push({ Diagnosis: `cat-${pad(c)}`, Drug: `drug-${pad(d)}` });
    }
    for (let k = 0; k < cats - c; k++) rows.push({ Diagnosis: `cat-${pad(c)}`, Drug: "drug-01" });
  }
  for (let d = 2; d <= drugs; d++) {
    for (let k = 0; k < drugs - d; k++) rows.push({ Diagnosis: "cat-01", Drug: `drug-${pad(d)}` });
  }
  return rows;
}

function bigSheet(opts) {
  return deriveSheet("Encounters", bigRows(opts));
}

function smallSheet() {
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

function pickBigCrosstab() {
  fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
  fireEvent.change(selects()[2], { target: { value: "Drug" } });
}

describe("P6-5 — crowded crosstab renders as small multiples", () => {
  it("recommends small multiples, draws the panel grid with a shared legend, and says its aria summary", () => {
    render(<ChartsPanel sheet={bigSheet()} />);
    pickBigCrosstab();

    expect(screen.getByText(/recommended: small multiples/i)).toBeTruthy();
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/^Small multiples of/);
    expect(img.getAttribute("aria-label")).toMatch(/cat-01/);
    // Legend swatch labels (subgroup names) draw as text in the SVG.
    expect(screen.getAllByText("drug-01").length).toBeGreaterThan(0);
  });

  it("caps panels at 12 with an honest note, and the full table below lists every category", () => {
    render(<ChartsPanel sheet={bigSheet()} />);
    pickBigCrosstab();

    expect(screen.getByText(/first 12 of 14/i)).toBeTruthy();
    // cat-13 and cat-14 are past the panel cap — they must still appear in
    // the full crosstab table.
    expect(screen.getByText("cat-13")).toBeTruthy();
    expect(screen.getByText("cat-14")).toBeTruthy();
    // The table's header row carries the un-truncated "Other" column name.
    expect(screen.getAllByText(/Other \(3 smaller groups\)/).length).toBeGreaterThan(0);
  });

  it("'Other options' switches to grouped bars and back to small multiples", () => {
    render(<ChartsPanel sheet={bigSheet()} />);
    pickBigCrosstab();

    fireEvent.click(screen.getByText("Other options"));
    fireEvent.click(screen.getByRole("button", { name: /^grouped bar chart$/i }));
    expect(screen.getByText(/recommended: grouped bar chart/i)).toBeTruthy();

    fireEvent.click(screen.getByText("Other options"));
    fireEvent.click(screen.getByRole("button", { name: /^small multiples$/i }));
    expect(screen.getByText(/recommended: small multiples/i)).toBeTruthy();
  });

  it("Excel steps give the helper table and the PivotChart-with-slicer route", () => {
    render(<ChartsPanel sheet={bigSheet()} />);
    pickBigCrosstab();

    expect(screen.getByText("Build the helper table")).toBeTruthy();
    expect(screen.getByText(/PivotChart/i)).toBeTruthy();
  });
});

describe("P6-5 — small crosstabs are untouched", () => {
  it("a small crosstab never offers small multiples", () => {
    render(<ChartsPanel sheet={smallSheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects()[2], { target: { value: "Drug" } });
    expect(screen.getByText(/recommended: grouped bar chart/i)).toBeTruthy();
    fireEvent.click(screen.getByText("Other options"));
    expect(screen.queryByRole("button", { name: /small multiples/i })).toBeNull();
  });
});
