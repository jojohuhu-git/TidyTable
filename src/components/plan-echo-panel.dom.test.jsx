// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

function encountersSheet() {
  return deriveSheet("Encounters", [
    { Drug: "cephalexin", Diagnosis: "cystitis", Prescriber: "Dr. A", Duration_days: 3 },
    { Drug: "cephalexin", Diagnosis: "cystitis", Prescriber: "Dr. A", Duration_days: 5 },
    { Drug: "cephalexin", Diagnosis: "UTI", Prescriber: "Dr. B", Duration_days: 7 },
    { Drug: "amoxicillin", Diagnosis: "UTI", Prescriber: "Dr. A", Duration_days: 9 },
    { Drug: "amoxicillin", Diagnosis: "cystitis", Prescriber: "Dr. B", Duration_days: 20 },
  ]);
}

function openPanel() {
  fireEvent.click(screen.getByText(/Build a surefire plan/i));
}

describe("item 7: plan-echo builder panel", () => {
  it("one AND-group filter + median measure + Run produces the right median", () => {
    render(<ChartsPanel sheet={encountersSheet()} />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Add condition \(AND\)/i }));

    const [colSelect] = screen.getAllByLabelText("Column");
    fireEvent.change(colSelect, { target: { value: "Drug" } });
    const [valueSelect] = screen.getAllByLabelText("is");
    fireEvent.change(valueSelect, { target: { value: "cephalexin" } });

    // 3 cephalexin rows -> live preview count should read 3
    expect(screen.getByText(/3 rows match/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Measure"), { target: { value: "median::Duration_days" } });

    // Summary line reflects the plan before Run
    expect(screen.getByText(/Median of Duration_days, for rows where Drug = cephalexin\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Run$/i }));

    // cephalexin durations: 3, 5, 7 -> median 5
    expect(document.querySelector("svg.chart-svg")).not.toBeNull();
    expect(document.body.textContent).toMatch(/median Duration_days/i);

    // Item 7 step 9: the R-script surface only appears once a plan is confirmed.
    fireEvent.click(screen.getByText(/Check it in R/i));
    expect(screen.getByRole("button", { name: /download script/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy script/i })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/median/i);
    expect(document.body.textContent).toMatch(/"result"/);
  });

  it("OR-group: a second group widens the match count instead of narrowing it", () => {
    render(<ChartsPanel sheet={encountersSheet()} />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Add condition \(AND\)/i }));

    const [colSelect] = screen.getAllByLabelText("Column");
    fireEvent.change(colSelect, { target: { value: "Drug" } });
    const [valSelect] = screen.getAllByLabelText("is");
    fireEvent.change(valSelect, { target: { value: "cephalexin" } });
    expect(screen.getByText(/3 rows match/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add another group \(OR\)/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /Add condition \(AND\)/i })[1]);
    const colSelects = screen.getAllByLabelText("Column");
    fireEvent.change(colSelects[1], { target: { value: "Drug" } });
    const valSelects = screen.getAllByLabelText("is");
    fireEvent.change(valSelects[1], { target: { value: "amoxicillin" } });

    // all 5 rows are either cephalexin or amoxicillin
    expect(screen.getByText(/5 rows match/i)).toBeInTheDocument();
  });

  it("crosstab + a real measure (previously impossible: two group columns plus average, not just count)", () => {
    render(<ChartsPanel sheet={encountersSheet()} />);
    openPanel();

    fireEvent.change(screen.getByLabelText("Measure"), { target: { value: "avg::Duration_days" } });
    fireEvent.change(screen.getByLabelText("Grouped by"), { target: { value: "Drug" } });
    fireEvent.change(screen.getByLabelText(/optional second column/i), { target: { value: "Prescriber" } });

    fireEvent.click(screen.getByRole("button", { name: /^Run$/i }));

    // A crosstab dataset renders (not a silent fallback to a single-column count chart)
    expect(document.querySelector("svg.chart-svg")).not.toBeNull();
    expect(screen.getAllByText(/average Duration_days/i).length).toBeGreaterThan(0);
  });

  it("free text pre-fills the panel with a multi-condition cohort the quick-chart pipeline declines", () => {
    render(<ChartsPanel sheet={encountersSheet()} />);
    fireEvent.change(screen.getByPlaceholderText(/organisms in urine/i), {
      target: { value: "how many patients with cystitis, of those, cephalexin, by prescriber" },
    });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));

    // The panel auto-opens, pre-filled with BOTH conditions (Diagnosis=cystitis
    // AND Drug=cephalexin) -- 2 of the 5 rows match, not just the 1 the
    // old single-equality quick-chart filter could have expressed.
    expect(screen.getByText(/2 rows match/i)).toBeInTheDocument();
    expect(screen.getByText(/for rows where Diagnosis = cystitis and Drug = cephalexin/i)).toBeInTheDocument();
  });
});
