// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CheckupPanel from "./CheckupPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P4-3 UI layer: the Step 2 checkup card must show the "values not on the
// dropdown list" finding (a warn-only scan no other detector covers), with
// the offending values visible so the owner can find them in Excel.

function sheetWithPicklistTypo() {
  const s = deriveSheet("Data", [
    { Diagnosis: "Cystitis", Ward: "ICU" },
    { Diagnosis: "Pyelonefritis", Ward: "General" }, // typo — not on the list
    { Diagnosis: "Cystitis", Ward: "General" },
  ]);
  s.vocab = { Diagnosis: ["cUTI", "Pyelonephritis", "Cystitis"] };
  return s;
}

describe("P4-3 — Step 2 shows the off-picklist finding", () => {
  it("renders the finding title and the offending value", () => {
    render(<CheckupPanel sheets={[sheetWithPicklistTypo()]} busy={false} onApply={vi.fn()} />);
    expect(screen.getByText(/values not on the "Diagnosis" dropdown list/i)).toBeInTheDocument();
    expect(screen.getByText(/Pyelonefritis/)).toBeInTheDocument();
  });

  it("shows nothing extra when every value is on the list", () => {
    const s = deriveSheet("Data", [{ Diagnosis: "Cystitis" }]);
    s.vocab = { Diagnosis: ["cUTI", "Cystitis"] };
    render(<CheckupPanel sheets={[s]} busy={false} onApply={vi.fn()} />);
    expect(screen.queryByText(/dropdown list/i)).not.toBeInTheDocument();
  });
});
