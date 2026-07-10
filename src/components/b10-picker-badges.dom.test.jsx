// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import StatsPanel from "./StatsPanel.jsx";
import RegressionWizard from "./RegressionWizard.jsx";
import { deriveSheet } from "../logic/workbook.js";

function sheet() {
  return deriveSheet("D", Array.from({ length: 20 }, (_, i) => ({
    PatientID: `P${i}`,
    Sex: i % 2 === 0 ? "M" : "F",
    Duration_days: 3 + (i % 7),
  })));
}

describe("B10 — StatsPanel column pickers are badged and reordered", () => {
  it("badges the grouping dropdown options and puts a low-cardinality column first", () => {
    render(<StatsPanel sheet={sheet()} />);
    const groupingSelect = screen.getAllByRole("combobox")[0];
    const opts = within(groupingSelect).getAllByRole("option").map((o) => o.textContent);
    expect(opts[1]).toMatch(/Sex \(text · 2 values\)/);
    expect(opts.some((o) => /PatientID \(text · 20 values\)/.test(o))).toBe(true);
  });

  it("badges the outcome dropdown and puts the numeric column first", () => {
    render(<StatsPanel sheet={sheet()} />);
    const outcomeSelect = screen.getAllByRole("combobox")[1];
    const opts = within(outcomeSelect).getAllByRole("option").map((o) => o.textContent);
    expect(opts[1]).toMatch(/Duration_days \(number\)/);
  });
});

describe("B10 — RegressionWizard predictor checkboxes are badged", () => {
  it("shows type/cardinality next to each predictor chip", () => {
    render(<RegressionWizard sheet={sheet()} />);
    expect(screen.getByText(/\(text · 2 values\)/)).toBeTruthy();
    expect(screen.getByText(/\(number\)/)).toBeTruthy();
  });
});
