// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CheckupPanel from "./CheckupPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

function encounters() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Sex: "M" },
    { PatientID: "P2", Sex: "Male" },
    { PatientID: "P3", Sex: "male" },
  ]);
}
function roster() {
  return deriveSheet("Roster", [
    { StaffID: "S1", Dose: "$1,200" },
    { StaffID: "S2", Dose: "250" },
  ]);
}

describe("P4-4 — Step 2 checks every sheet, combined list labeled by sheet", () => {
  it("shows findings from both sheets, each tagged with its sheet name", () => {
    render(<CheckupPanel sheets={[encounters(), roster()]} busy={false} onApply={vi.fn()} />);
    expect(screen.getAllByText("Encounters").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Roster").length).toBeGreaterThan(0);
  });

  it("does not show a sheet label when the workbook has only one sheet", () => {
    render(<CheckupPanel sheets={[encounters()]} busy={false} onApply={vi.fn()} />);
    expect(screen.queryByText("Encounters")).not.toBeInTheDocument();
  });

  it("applying a fix from the second sheet reports which sheet it belongs to", () => {
    const onApply = vi.fn();
    render(<CheckupPanel sheets={[encounters(), roster()]} busy={false} onApply={onApply} />);
    // Tick every safe fix (includes the Roster "Dose" text-numbers fix) and apply.
    fireEvent.click(screen.getByRole("button", { name: /tick all safe fixes/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply \d+ selected fix/i }));
    const fixes = onApply.mock.calls[0][0];
    const doseFix = fixes.find((f) => f.column === "Dose");
    expect(doseFix.sheet).toBe("Roster");
    const sexFix = fixes.find((f) => f.column === "Sex");
    expect(sexFix.sheet).toBe("Encounters");
  });
});
