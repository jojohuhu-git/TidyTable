// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import StatsPanel from "../src/components/StatsPanel.jsx";
import RegressionWizard from "../src/components/RegressionWizard.jsx";
import { deriveSheet } from "../src/logic/workbook.js";

function tableSheet([[a, b], [c, d]]) {
  const rows = [];
  const add = (g, o, n) => { for (let i = 0; i < n; i++) rows.push({ Group: g, Outcome: o }); };
  add("A", "yes", a); add("A", "no", b); add("B", "yes", c); add("B", "no", d);
  return deriveSheet("Data", rows);
}

function pickColumns() {
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: "Group" } });
  fireEvent.change(selects[1], { target: { value: "Outcome" } });
}

describe("StatsPanel shows the work", () => {
  it("renders the built table, expected counts, chi-square, OR and OpenEpi cross-check", () => {
    render(<StatsPanel sheet={tableSheet([[12, 8], [5, 15]])} />);
    pickColumns();
    expect(screen.getByText("Chi-square test")).toBeInTheDocument();
    expect(screen.getByText(/expected counts if the two were unrelated/i)).toBeInTheDocument();
    expect(screen.getByText(/odds ratio/i)).toBeInTheDocument();
    expect(screen.getByText(/openepi\.com/i)).toBeInTheDocument();
    // Association language, never causation.
    expect(screen.getByText(/association only/i)).toBeInTheDocument();
    expect(screen.queryByText(/\bcauses\b/i)).toBeNull();
  });

  it("auto-switches to Fisher and states the reason when an expected count is small", () => {
    render(<StatsPanel sheet={tableSheet([[1, 9], [8, 2]])} />);
    pickColumns();
    expect(screen.getByText("Fisher's exact test")).toBeInTheDocument();
    expect(screen.getByText(/below 5/i)).toBeInTheDocument();
  });

  it("P2-4: shows a 'How to use this step' panel with a verified example that fills both pickers and runs", () => {
    render(<StatsPanel sheet={tableSheet([[12, 8], [5, 15]])} />);
    expect(screen.getByText("How to use this step")).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: /Group vs Outcome|Outcome by Group/i });
    fireEvent.click(chip);
    expect(screen.getByText("Chi-square test")).toBeInTheDocument();
  });
});

describe("RegressionWizard gates on events per variable", () => {
  function fillWizard({ events, predictorCount }) {
    const sheet = deriveSheet("Data", [
      { Died: "yes", Age: 70, Sex: "M", Ward: "A", Drug: "x", Dose: 1, Days: 2, Renal: "no", Prior: 1, Extra: 0 },
      { Died: "no", Age: 60, Sex: "F", Ward: "B", Drug: "y", Dose: 2, Days: 3, Renal: "yes", Prior: 0, Extra: 1 },
    ]);
    render(<RegressionWizard sheet={sheet} />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "yesno" } });
    fireEvent.change(selects[1], { target: { value: "no" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: String(events) } });
    const boxes = screen.getAllByRole("checkbox").slice(0, predictorCount);
    boxes.forEach((b) => fireEvent.click(b));
  }

  it("refuses 38 events with 9 predictors", () => {
    fillWizard({ events: 38, predictorCount: 9 });
    expect(screen.getByText(/per variable/i)).toBeInTheDocument();
    expect(screen.getByText(/below the ~10/i)).toBeInTheDocument();
  });

  it("proceeds and offers a logistic script with 38 events and 3 predictors", () => {
    fillWizard({ events: 38, predictorCount: 3 });
    expect(screen.getByText(/looks reasonable/i)).toBeInTheDocument();
  });
});
