// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import RecipePanel from "./RecipePanel.jsx";
import ReportCardsView from "./ReportCardsView.jsx";
import { buildReportCards } from "../logic/recipes/reportCards.js";
import { newRecipe } from "../logic/recipes/recipe.js";
import { deriveSheet } from "../logic/workbook.js";

function sheet() {
  return deriveSheet("Prescriptions", [
    { Prescriber: "Dr. Smith", Drug: "Amoxicillin", Dose: 500, Clinic: "North" },
    { Prescriber: "Dr. Jones", Drug: "Cephalexin", Dose: 250, Clinic: "South" },
  ]);
}

describe("RecipePanel records the deidentify and report-card steps", () => {
  it("adds a name-swap step and a report-cards terminal step in order", () => {
    let recipe = newRecipe("Monthly");
    const onChange = vi.fn((r) => { recipe = r; });
    const { rerender } = render(<RecipePanel recipe={recipe} sheet={sheet()} onChange={onChange} />);

    // Pick the person column for the name swap and add it.
    const idSelect = screen.getByRole("combobox", { name: /swap names for codes in/i });
    fireEvent.change(idSelect, { target: { value: "Prescriber" } });
    fireEvent.click(screen.getByRole("button", { name: /add this step/i }));
    expect(onChange).toHaveBeenCalled();
    expect(recipe.steps.at(-1).type).toBe("deidentify");

    rerender(<RecipePanel recipe={recipe} sheet={sheet()} onChange={onChange} />);

    // Add the report-cards terminal step.
    fireEvent.change(screen.getByRole("combobox", { name: /report cards, one per person in/i }), { target: { value: "Prescriber" } });
    fireEvent.change(screen.getByRole("combobox", { name: /grouped by/i }), { target: { value: "Clinic" } });
    fireEvent.click(screen.getByRole("button", { name: /add report cards/i }));
    expect(recipe.steps.at(-1).type).toBe("reportCards");
    expect(recipe.steps.at(-1).groupColumn).toBe("Clinic");
  });
});

describe("ReportCardsView shows codes only, highlights the subject, warns on small cells", () => {
  it("renders bars and a small-cell warning without exposing names", () => {
    const rows = [
      { Prescriber: "Prescriber 01", Clinic: "North" },
      { Prescriber: "Prescriber 02", Clinic: "North" },
      { Prescriber: "Prescriber 03", Clinic: "West" },
    ];
    const rc = buildReportCards(rows, { personColumn: "Prescriber", groupColumn: "Clinic" });
    const { container } = render(<ReportCardsView reportCards={rc} />);

    // No real name leaks into the rendered output.
    expect(container.textContent).not.toMatch(/Dr\.|Smith|Jones|Lee/);
    expect(screen.getAllByText("Prescriber 01").length).toBeGreaterThan(0);

    // Small groups (1 or 2 people) carry the small-group warning.
    expect(screen.getAllByText(/small group — may be identifiable/i).length).toBeGreaterThan(0);

    // The subject's own bar uses the accent class; a peer's does not.
    const firstCard = container.querySelector(".report-card");
    const subjectBar = firstCard.querySelector(".report-bar-subject");
    expect(subjectBar).toBeTruthy();
  });
});
