// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

describe("B9 — ChartsPanel value dropdown only offers numeric columns", () => {
  it("excludes a text column from the value dropdown, offering only numeric ones", () => {
    const sheet = deriveSheet("D", [
      { Dx: "UTI", Drug: "cephalexin", Cost: 10 },
      { Dx: "UTI", Drug: "amoxicillin", Cost: 20 },
    ]);
    render(<ChartsPanel sheet={sheet} />);
    const valueSelect = screen.getAllByRole("combobox")[1];
    const options = within(valueSelect).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("total Cost");
    expect(options).not.toContain("total Drug");
    expect(options).not.toContain("total Dx");
  });

  it("shows an honest note when there are no numeric columns at all", () => {
    const sheet = deriveSheet("D", [{ Dx: "UTI", Drug: "cephalexin" }, { Dx: "UTI", Drug: "amoxicillin" }]);
    render(<ChartsPanel sheet={sheet} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Dx" } });
    expect(screen.getByText(/no numeric columns to total/i)).toBeTruthy();
  });
});

describe("B9 — ChartsPanel shows a real chart title and a download button", () => {
  it("titles the bar preview 'count by <label column>' and includes it in the chart's aria-label", () => {
    const sheet = deriveSheet("D", [{ Dx: "UTI" }, { Dx: "UTI" }, { Dx: "pneumonia" }]);
    render(<ChartsPanel sheet={sheet} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Dx" } });
    expect(screen.getByText("count by Dx")).toBeTruthy();
    expect(screen.getByRole("img", { name: /bar chart of count by dx/i })).toBeTruthy();
  });

  it("offers a 'Download chart as image' button that doesn't throw when clicked", () => {
    const sheet = deriveSheet("D", [{ Dx: "UTI" }, { Dx: "UTI" }, { Dx: "pneumonia" }]);
    render(<ChartsPanel sheet={sheet} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Dx" } });
    const btn = screen.getByRole("button", { name: /download chart as image/i });
    expect(() => fireEvent.click(btn)).not.toThrow();
  });
});
