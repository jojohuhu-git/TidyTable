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
