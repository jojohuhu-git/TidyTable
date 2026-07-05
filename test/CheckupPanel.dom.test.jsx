// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CheckupPanel from "../src/components/CheckupPanel.jsx";
import { deriveSheet } from "../src/logic/workbook.js";

function messySheet() {
  return deriveSheet("Patients", [
    { ID: "P1", Sex: "Male", Result: "0.8" },
    { ID: "P2", Sex: "male", Result: "<0.5" },
    { ID: "P3", Sex: "male", Result: "1.2" },
    { ID: "P1", Sex: "Male", Result: "0.8" }, // duplicate
  ]);
}

describe("CheckupPanel", () => {
  it("lists findings and only applies ticked fixes", () => {
    const onApply = vi.fn();
    render(<CheckupPanel sheet={messySheet()} busy={false} onApply={onApply} />);

    // The duplicate-row finding is present and applies when ticked.
    const dupCheckbox = screen.getByText("Duplicate rows").closest("label").querySelector("input");
    fireEvent.click(dupCheckbox);
    fireEvent.click(screen.getByRole("button", { name: /apply 1 selected fix/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const fixes = onApply.mock.calls[0][0];
    expect(fixes).toEqual([{ normalizer: "dedupeRows", column: null, params: {} }]);
  });

  it("asks a policy question before a censored fix can be selected", () => {
    const onApply = vi.fn();
    render(<CheckupPanel sheet={messySheet()} busy={false} onApply={onApply} />);

    const censoredLabel = screen.getByText(/Below\/above-limit results/i).closest("label");
    fireEvent.click(censoredLabel.querySelector("input"));

    // The ClarifyBox appears; nothing is selected yet.
    expect(screen.getByText(/how should the below\/above-limit results/i)).toBeInTheDocument();

    // Answer "treat as missing", then the fix is selectable and carries the policy.
    fireEvent.click(screen.getByRole("button", { name: /treat as missing/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply 1 selected fix/i }));

    const fixes = onApply.mock.calls[0][0];
    expect(fixes[0]).toMatchObject({ normalizer: "censoredValues", column: "Result", params: { policy: "missing" } });
  });

  it("lets any finding be dismissed", () => {
    render(<CheckupPanel sheet={messySheet()} busy={false} onApply={() => {}} />);
    expect(screen.getByText("Duplicate rows")).toBeInTheDocument();
    const dismiss = screen.getByText("Duplicate rows").closest(".finding").querySelector(".finding-dismiss");
    fireEvent.click(dismiss);
    expect(screen.queryByText("Duplicate rows")).toBeNull();
  });
});
