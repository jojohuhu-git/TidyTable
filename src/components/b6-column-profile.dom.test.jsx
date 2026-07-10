// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ColumnProfileTable from "./ColumnProfileTable.jsx";
import { deriveSheet } from "../logic/workbook.js";

describe("B6 — ColumnProfileTable", () => {
  it("shows one row per column with type, % filled, distinct count, and a values summary", () => {
    const sheet = deriveSheet("D", [
      { Age: 10, Dx: "UTI" }, { Age: 20, Dx: "UTI" }, { Age: null, Dx: "pneumonia" },
    ]);
    render(<ColumnProfileTable sheet={sheet} />);
    expect(screen.getByText(/2 columns/)).toBeTruthy();
    const table = screen.getByRole("table");
    expect(table.textContent).toMatch(/Age/);
    expect(table.textContent).toMatch(/67%/); // 2 of 3 filled
    expect(table.textContent).toMatch(/10 – 20/);
    expect(table.textContent).toMatch(/UTI \(2\)/);
  });

  it("flags an empty column in plain English", () => {
    const sheet = deriveSheet("D", [{ A: 1, B: null }, { A: 2, B: null }]);
    render(<ColumnProfileTable sheet={sheet} />);
    expect(screen.getByText(/nothing to analyze here/i)).toBeTruthy();
  });
});
