// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReplayPanel from "./ReplayPanel.jsx";
import { runOffline } from "../logic/offline/runOffline.js";
import { newRecipe, addStep, questionStep, saveRecipe } from "../logic/recipes/recipe.js";
import { deriveSheet } from "../logic/workbook.js";

// W3: a question answered offline in Step 3 is auto-recorded into the routine
// (recipe.js questionStep) and must replay on next month's file the same way
// a checkup fix does — re-resolving its columns against the new headers, and
// reporting a renamed/missing column plainly (never guessing) via the UI.

function month1() {
  const enc = deriveSheet("Encounters", [
    { PatientID: "P1", Ward: "ICU", Diagnosis: "pyelonephritis" },
    { PatientID: "P2", Ward: "General", Diagnosis: "UTI" },
  ]);
  return { fileName: "DC antibiotics.xlsx", sheets: [enc] };
}

const REQUEST = "how many patients with pyelonephritis, and of those how many were ICU";

function recordedRoutine() {
  const res = runOffline(REQUEST, month1(), {});
  let recipe = newRecipe("DC antibiotics — monthly");
  recipe = addStep(recipe, questionStep(REQUEST, res.match, "1 row"));
  return recipe;
}

describe("ReplayPanel replays a recorded question step", () => {
  beforeEach(() => localStorage.clear());

  it("reports a renamed column plainly instead of guessing", async () => {
    const recipe = recordedRoutine();
    saveRecipe(recipe);

    render(<ReplayPanel keyStore={null} onKeyStore={() => {}} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: recipe.name } });

    // Next month's file: "Ward" renamed to "Unit" — a true rename, not just a
    // re-spacing, so it must NOT silently line up with the recorded "Ward".
    const csv = "PatientID,Unit,Diagnosis\nP1,ICU,pyelonephritis\nP3,ICU,pyelonephritis\n";
    const file = new File([csv], "next-month.csv", { type: "text/csv" });
    const fileInput = document.querySelector('input[type="file"][accept=".xlsx,.xls,.csv"]');
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/Ready:.*next-month\.csv/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /run the routine on this file/i }));

    await waitFor(() => expect(screen.getByText(/Surprises that need your attention/i)).toBeTruthy());
    expect(screen.getByText(/no column matching "Ward"/i)).toBeTruthy();
    expect(screen.getByText(/could not be answered/i)).toBeTruthy();
  });

  it("answers correctly and shows a plain report line when every column still matches", async () => {
    const recipe = recordedRoutine();
    saveRecipe(recipe);

    render(<ReplayPanel keyStore={null} onKeyStore={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: recipe.name } });

    const csv = "PatientID,Ward,Diagnosis\nP1,ICU,pyelonephritis\nP3,ICU,pyelonephritis\nP4,General,pyelonephritis\n";
    const file = new File([csv], "next-month.csv", { type: "text/csv" });
    const fileInput = document.querySelector('input[type="file"][accept=".xlsx,.xls,.csv"]');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Ready:.*next-month\.csv/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /run the routine on this file/i }));

    await waitFor(() => expect(screen.getByText(/No surprises/i)).toBeTruthy());
    expect(screen.getByText(/Answered:.*pyelonephritis.*ICU/i)).toBeTruthy();
    expect(screen.getByText(/2 rows/i)).toBeTruthy();
  });
});
