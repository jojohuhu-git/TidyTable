// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

  it("P2-1: keeps the detail text and sample chips collapsed behind a 'What's this?' expander", () => {
    render(<CheckupPanel sheet={messySheet()} busy={false} onApply={() => {}} />);
    const item = screen.getByText("Duplicate rows").closest(".finding");

    // Detail text and sample chips exist in the DOM (inside <details>) but are collapsed by default.
    const expander = item.querySelector(".finding-expander");
    expect(expander).not.toBeNull();
    expect(expander.hasAttribute("open")).toBe(false);
    expect(item.querySelector(".finding-detail")).not.toBeNull();

    // The one-line row keeps checkbox + title + count + Skip, without needing the expander open.
    expect(item.querySelector(".finding-line .finding-title")).not.toBeNull();
    expect(item.querySelector(".finding-line .finding-count")).not.toBeNull();
    expect(item.querySelector(".finding-line .finding-dismiss")).not.toBeNull();

    fireEvent.click(item.querySelector(".finding-expander summary"));
    expect(expander.hasAttribute("open")).toBe(true);
  });

  it("P2-2: splits fixable findings into 'Safe fixes' vs 'Needs your call', and 'Tick all safe fixes' selects only the safe ones", () => {
    const onApply = vi.fn();
    render(<CheckupPanel sheet={messySheet()} busy={false} onApply={onApply} />);

    // Duplicate rows is a safe fix (no policy question); censored is "needs your call".
    expect(screen.getByText("Safe fixes — nothing is lost")).toBeInTheDocument();
    expect(screen.getByText("Needs your call")).toBeInTheDocument();
    const safeSection = screen.getByText("Safe fixes — nothing is lost").closest("section");
    const callSection = screen.getByText("Needs your call").closest("section");
    expect(safeSection.querySelector(".finding")).not.toBeNull();
    expect(within(callSection).getByText(/Below\/above-limit results/i)).toBeInTheDocument();
    // The censored finding must NOT be in the safe section.
    expect(within(safeSection).queryByText(/Below\/above-limit results/i)).toBeNull();

    // messySheet's safe fixes are duplicate rows + the Sex spelling variants;
    // the censored Result finding needs a policy answer, so it stays unticked.
    fireEvent.click(screen.getByRole("button", { name: /tick all safe fixes/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply 2 selected fixes/i }));

    const fixes = onApply.mock.calls[0][0];
    expect(fixes.map((f) => f.normalizer).sort()).toEqual(["dedupeRows", "trimCase"]);
  });

  it("P2-4: shows the 'How to use this step' panel with no clickable examples (no text box to fill yet)", () => {
    render(<CheckupPanel sheet={messySheet()} busy={false} onApply={() => {}} />);
    expect(screen.getByText("How to use this step")).toBeInTheDocument();
    expect(screen.getByText(/Automatically scans your first sheet/i)).toBeInTheDocument();
    expect(screen.getByText(/Only checks the first sheet/i)).toBeInTheDocument();
    expect(screen.queryByText("Try these:")).toBeNull();
  });

  it("P2-3: typing 'remove the duplicates' ticks the matching finding and confirms it", () => {
    const onApply = vi.fn();
    render(<CheckupPanel sheet={messySheet()} busy={false} onApply={onApply} />);

    const input = screen.getByLabelText("Or tell me what to clean…");
    fireEvent.change(input, { target: { value: "remove the duplicates" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    expect(screen.getByText("Ticked: Duplicate rows.")).toBeInTheDocument();
    const dupCheckbox = screen.getByText("Duplicate rows").closest("label").querySelector("input");
    expect(dupCheckbox.checked).toBe(true);
    // The box clears once resolved, and Apply now runs the ticked fix.
    expect(input.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /apply 1 selected fix/i }));
    expect(onApply.mock.calls[0][0]).toEqual([{ normalizer: "dedupeRows", column: null, params: {} }]);
  });

  it("P2-3: recognized but absent intent says so honestly instead of guessing", () => {
    render(<CheckupPanel sheet={messySheet()} busy={false} onApply={() => {}} />);
    const input = screen.getByLabelText("Or tell me what to clean…");
    fireEvent.change(input, { target: { value: "fix the dates" } }); // messySheet has no date column
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText("No date-formatting issues were found in this sheet.")).toBeInTheDocument();
  });

  it("P2-3: an unrecognized request shows the honest fallback and keeps the text so it can be edited", () => {
    render(<CheckupPanel sheet={messySheet()} busy={false} onApply={() => {}} />);
    const input = screen.getByLabelText("Or tell me what to clean…");
    fireEvent.change(input, { target: { value: "make it sparkle" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText(/Add an AI key/)).toBeInTheDocument();
    expect(input.value).toBe("make it sparkle");
  });
});
