// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CheckupPanel from "./CheckupPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

function sheet() {
  return deriveSheet("Patients", [
    { PatientID: "P1", Sex: "Male" },
    { PatientID: "P2", Sex: "Male" },
    { PatientID: "P3", Sex: "male" },
    { PatientID: "P4", Sex: "MALE" },
  ]);
}

describe("A6 — CheckupPanel lets the user pick the surviving spelling in a category merge", () => {
  it("defaults to the most common spelling, and applying uses it", () => {
    const onApply = vi.fn();
    render(<CheckupPanel sheets={[sheet()]} busy={false} onApply={onApply} />);

    // Default canonical ("Male") chip is shown active; select the finding and apply.
    const maleChip = screen.getByRole("button", { name: /^Male \(2\)$/ });
    expect(maleChip.className).toMatch(/variant-chip-active/);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /apply 1 selected fix/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const fixes = onApply.mock.calls[0][0];
    expect(fixes[0].params.map).toEqual({ male: "Male", MALE: "Male" });
  });

  it("picking a different spelling changes which one survives", () => {
    const onApply = vi.fn();
    render(<CheckupPanel sheets={[sheet()]} busy={false} onApply={onApply} />);

    // Override the canonical spelling to the all-caps variant.
    fireEvent.click(screen.getByRole("button", { name: /^MALE \(1\)$/ }));
    expect(screen.getByRole("button", { name: /^MALE \(1\)$/ }).className).toMatch(/variant-chip-active/);
    expect(screen.getByRole("button", { name: /^Male \(2\)$/ }).className).not.toMatch(/variant-chip-active/);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /apply 1 selected fix/i }));

    const fixes = onApply.mock.calls[0][0];
    expect(fixes[0].params.map).toEqual({ Male: "MALE", male: "MALE" });
  });
});
