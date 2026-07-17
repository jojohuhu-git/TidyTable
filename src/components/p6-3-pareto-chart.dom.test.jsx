// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P6-3: "add cumulative % line" — a one-click, off-by-default toggle on a
// ranked count bar chart. Fixture: same 8/5/3/2/1/1 shape as the logic test,
// so "Top 3 of 6 account for 80%" is the expected caption here too.
function sheet() {
  const rows = [];
  const counts = { drugA: 8, drugB: 5, drugC: 3, drugD: 2, drugE: 1, drugF: 1 };
  let i = 0;
  for (const [drug, n] of Object.entries(counts)) {
    for (let j = 0; j < n; j++) rows.push({ PatientID: `P${i++}`, Drug: drug });
  }
  return deriveSheet("Encounters", rows);
}

function selects() {
  return screen.getAllByRole("combobox");
}

describe("P6-3 — Pareto cumulative % line toggle", () => {
  it("is off by default and not shown for a non-count (sum/average) bar", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Drug" } });
    expect(screen.getByLabelText(/cumulative % line/i)).toBeTruthy();
    expect(screen.queryByText(/top \d+ of \d+ account for/i)).toBeNull();
  });

  it("checking the toggle draws the cumulative line and states the vital-few caption", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Drug" } });
    fireEvent.click(screen.getByLabelText(/cumulative % line/i));
    expect(screen.getByText("Top 3 of 6 account for 80%.")).toBeTruthy();
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/top 3 of 6 account for 80%/i);
  });

  it("unchecking removes the cumulative line and its caption", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Drug" } });
    const toggle = screen.getByLabelText(/cumulative % line/i);
    fireEvent.click(toggle);
    expect(screen.getByText(/top 3 of 6 account for 80%/i)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText(/top 3 of 6 account for 80%/i)).toBeNull();
  });

  it("is hidden entirely when the bar totals a numeric column instead of counting rows", () => {
    const withValue = deriveSheet("Encounters", [
      { Drug: "drugA", Dose_mg: 10 },
      { Drug: "drugB", Dose_mg: 20 },
    ]);
    render(<ChartsPanel sheet={withValue} />);
    fireEvent.change(selects()[0], { target: { value: "Drug" } });
    fireEvent.change(selects()[1], { target: { value: "Dose_mg" } });
    expect(screen.queryByLabelText(/cumulative % line/i)).toBeNull();
  });

  it("Excel steps include the native Pareto chart step only when the toggle is on", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(selects()[0], { target: { value: "Drug" } });
    expect(screen.queryByText("Add the cumulative % line")).toBeNull();
    fireEvent.click(screen.getByLabelText(/cumulative % line/i));
    expect(screen.getByText("Add the cumulative % line")).toBeTruthy();
  });
});
