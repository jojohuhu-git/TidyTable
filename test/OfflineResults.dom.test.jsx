// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultsPanel from "../src/components/ResultsPanel.jsx";
import ClarifyBox from "../src/components/ClarifyBox.jsx";
import { runOffline } from "../src/logic/offline/runOffline.js";
import { deriveSheet } from "../src/logic/workbook.js";

function book() {
  return {
    fileName: "m.xlsx",
    sheets: [
      deriveSheet("Encounters", [
        { Diagnosis: "pyelonephritis", Drug: "cephalexin", PatientID: "P1" },
        { Diagnosis: "pyelonephritis", Drug: "amoxicillin", PatientID: "P2" },
        { Diagnosis: "cystitis", Drug: "cephalexin", PatientID: "P3" },
      ]),
    ],
  };
}

describe("offline answer renders with the trust panel", () => {
  const res = runOffline("of patients with pyelonephritis, how many got cephalexin", book());

  it("produced an offline answer with no key", () => {
    expect(res.kind).toBe("answer");
  });

  it("shows the 'what I looked for' trust line and the offline label", () => {
    render(<ResultsPanel plan={res.plan} rows={res.resultRows} />);
    expect(screen.getByText(/what i looked for/i)).toBeInTheDocument();
    expect(screen.getAllByText(/counting rows where/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/answered on this computer/i)).toBeInTheDocument();
  });

  it("shows the nested counts in the result table", () => {
    render(<ResultsPanel plan={res.plan} rows={res.resultRows} />);
    // Diagnosis is pyelonephritis: 2 of 3; Drug is cephalexin: 1 of 2.
    expect(screen.getAllByText(/is pyelonephritis/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Out of")).toBeInTheDocument();
  });
});

describe("grain clarify box offers the two plain choices", () => {
  it("renders the combine-or-count-rows question", () => {
    const answers = [];
    render(
      <ClarifyBox
        question="Each patient appears on more than one row. Combine first?"
        options={[
          { value: "group-then-test", label: "Combine each patient's rows first", detail: "count patients" },
          { value: "row", label: "Count rows as they are", detail: "one row at a time" },
        ]}
        onAnswer={(v) => answers.push(v)}
      />,
    );
    expect(screen.getByText(/combine each patient's rows first/i)).toBeInTheDocument();
    expect(screen.getByText(/count rows as they are/i)).toBeInTheDocument();
  });
});
