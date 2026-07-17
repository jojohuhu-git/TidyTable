// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ShelfPanel from "./ShelfPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P1-12: reshapeLongToWide's collision count used to be computed but never
// shown — a silent overwrite in an app whose house rule is "never silently
// drop or guess". The notice must actually render when a collision happens.
function workbookWithCollision() {
  const encounters = deriveSheet("Encounters", [
    { PatientID: "P1", Test: "Na", Value: "140" },
    { PatientID: "P1", Test: "Na", Value: "145" }, // same patient + measure again
  ]);
  return { fileName: "m.xlsx", sheets: [encounters] };
}

describe("ShelfPanel — long2wide collision notice", () => {
  it("shows a notice when the same id+measure pair collides", () => {
    render(<ShelfPanel workbook={workbookWithCollision()} />);

    // The op picker and the field pickers aren't <label>-associated, so
    // select by position: op picker first, then (once long2wide's fields
    // render) Patient/Measure-name/Measure-value column, in that order.
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "long2wide" } });
    const fields = screen.getAllByRole("combobox").slice(1);
    fireEvent.change(fields[0], { target: { value: "PatientID" } });
    fireEvent.change(fields[1], { target: { value: "Test" } });
    fireEvent.change(fields[2], { target: { value: "Value" } });

    expect(screen.getByRole("status")).toHaveTextContent(/1 value was overwritten/i);
  });
});

// P2-4: the shared "How to use this step" panel, wired to the one shelf
// operation ("one row per patient" -> wide-to-long) that needs only the
// first sheet, so its example chip can honestly run with no second sheet.
function onePatientPerRowWorkbook() {
  const patients = deriveSheet("Patients", [
    { PatientID: "P1", Age: "70", Weight: "80" },
    { PatientID: "P2", Age: "60", Weight: "65" },
    { PatientID: "P3", Age: "55", Weight: "90" },
    { PatientID: "P4", Age: "40", Weight: "70" },
  ]);
  return { fileName: "p.xlsx", sheets: [patients] };
}

describe("ShelfPanel — P2-4 how-to-use panel", () => {
  it("shows the panel and a single-sheet reshape example that fills the pickers and runs", () => {
    render(<ShelfPanel workbook={onePatientPerRowWorkbook()} />);
    expect(screen.getByText("How to use this step")).toBeInTheDocument();

    const chip = screen.getByRole("button", { name: /PatientID/i });
    fireEvent.click(chip);

    expect(screen.getAllByRole("combobox")[0].value).toBe("wide2long");
    expect(screen.getByText(/\d+ rows\./)).toBeInTheDocument();
  });

  it("says most operations need a second sheet, for a single-sheet workbook", () => {
    render(<ShelfPanel workbook={onePatientPerRowWorkbook()} />);
    expect(screen.getByText(/Most of these need a second sheet/i)).toBeInTheDocument();
  });
});
