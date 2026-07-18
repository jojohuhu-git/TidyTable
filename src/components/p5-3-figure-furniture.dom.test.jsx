// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P5-3: figure furniture — UI layer. An editable figure title and footnote
// that render INSIDE the chart SVG (so every export path carries them), a
// caption box whose text is copyable for a manuscript figure legend, and
// the grayscale-safe toggle.

function sheet() {
  return deriveSheet("D", [{ Dx: "UTI" }, { Dx: "UTI" }, { Dx: "pneumonia" }]);
}

function setup() {
  render(<ChartsPanel sheet={sheet()} />);
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Dx" } });
}

describe("P5-3 — editable title and footnote render inside the SVG", () => {
  it("typing a figure title replaces the automatic one on the chart and in its aria-label", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/figure title/i), { target: { value: "Figure 1. Diagnoses" } });
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/Figure 1\. Diagnoses/);
    expect(img.querySelector(".chart-title").textContent).toBe("Figure 1. Diagnoses");
  });

  it("typing a footnote draws it on the chart itself, not just the page", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/footnote/i), { target: { value: "n = 3 encounters, Jan-Jun 2026" } });
    const img = screen.getByRole("img");
    expect(img.textContent).toContain("n = 3 encounters, Jan-Jun 2026");
  });
});

describe("P5-3 — copyable caption box", () => {
  it("shows the composed caption with a copy button", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/footnote/i), { target: { value: "n = 3 encounters" } });
    expect(screen.getByText(/count by Dx\. n = 3 encounters\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy caption/i })).toBeTruthy();
  });
});

describe("P5-3 — grayscale-safe toggle", () => {
  it("switches bar fills off the Okabe-Ito hues to the dark-to-light family", () => {
    setup();
    const firstBar = () => screen.getByRole("img").querySelector("rect");
    expect(firstBar().getAttribute("fill")).toBe("#E69F00");
    fireEvent.click(screen.getByLabelText(/grayscale|black.and.white/i));
    expect(firstBar().getAttribute("fill")).not.toBe("#E69F00");
  });

  it("also switches a crosstab's subgroup colors (the place color carries identity)", () => {
    render(<ChartsPanel sheet={deriveSheet("E", [
      { Diagnosis: "UTI", Drug: "cephalexin" },
      { Diagnosis: "UTI", Drug: "amoxicillin" },
      { Diagnosis: "pneumonia", Drug: "azithromycin" },
    ])} />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "Diagnosis" } });
    fireEvent.change(selects[2], { target: { value: "Drug" } });
    fireEvent.click(screen.getByLabelText(/grayscale|black.and.white/i));
    const fills = [...screen.getByRole("img").querySelectorAll("rect")].map((r) => r.getAttribute("fill"));
    expect(fills.some((f) => f === "#E69F00")).toBe(false);
  });
});
