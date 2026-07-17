// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartPreview from "./ChartPreview.jsx";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P3-3: request-aware emphasis rendered onto the SVG itself, so it survives
// into the PNG download (same SVG, no separate render path).

function countDataset(points, countTotal) {
  return { kind: "categorical", points, valueName: "count", labelName: "Drug", countTotal };
}

describe("P3-3 ChartPreview — automatic largest-category subtitle", () => {
  it("renders the callout as a second title line", () => {
    const dataset = countDataset([{ label: "Cephalexin", value: 3 }, { label: "Nitrofurantoin", value: 1 }], 4);
    const { container } = render(<ChartPreview chartType="bar" dataset={dataset} title="count by Drug" />);
    const subtitle = container.querySelector(".chart-subtitle");
    expect(subtitle).toBeTruthy();
    expect(subtitle.textContent).toBe("Most common: Cephalexin (75%)");
  });

  it("renders no subtitle when the top two are tied", () => {
    const dataset = countDataset([{ label: "A", value: 2 }, { label: "B", value: 2 }], 4);
    const { container } = render(<ChartPreview chartType="bar" dataset={dataset} title="count by Drug" />);
    expect(container.querySelector(".chart-subtitle")).toBeFalsy();
  });
});

describe("P3-3 ChartPreview — value labels capped at 12 categories", () => {
  it("shows a value label per bar at 12 or fewer categories", () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ label: `C${i}`, value: 12 - i }));
    const dataset = countDataset(points, points.reduce((s, p) => s + p.value, 0));
    const { container } = render(<ChartPreview chartType="bar" dataset={dataset} />);
    expect(container.querySelectorAll(".chart-value").length).toBe(12);
  });

  it("hides value labels beyond 12 categories (still readable via aria-label and the Excel helper table)", () => {
    const points = Array.from({ length: 13 }, (_, i) => ({ label: `C${i}`, value: 13 - i }));
    const dataset = countDataset(points, points.reduce((s, p) => s + p.value, 0));
    const { container } = render(<ChartPreview chartType="bar" dataset={dataset} />);
    expect(container.querySelectorAll(".chart-value").length).toBe(0);
  });
});

describe("P3-3 ChartPreview — highlightLabel wiring (already-existing prop, now actually passed by callers)", () => {
  it("colors the named bar with the accent color and every other bar grey", () => {
    const dataset = countDataset([{ label: "Cephalexin", value: 3 }, { label: "Nitrofurantoin", value: 1 }], 4);
    const { container } = render(<ChartPreview chartType="bar" dataset={dataset} highlightLabel="Cephalexin" />);
    const rects = container.querySelectorAll("rect");
    expect(rects[0].getAttribute("fill")).toBe("var(--accent)");
    expect(rects[1].getAttribute("fill")).toBe("var(--line)");
  });
});

describe("P3-3 ChartPreview — average/threshold reference line on bar charts", () => {
  it("draws a dashed line and label at the given value", () => {
    const dataset = { kind: "categorical", points: [{ label: "A", value: 4 }, { label: "B", value: 6 }], valueName: "average Duration_days", labelName: "Drug" };
    const { container } = render(
      <ChartPreview chartType="bar" dataset={dataset} referenceLine={{ value: 5, label: "average" }} />,
    );
    const line = container.querySelector(".chart-refline");
    expect(line).toBeTruthy();
    expect(line.getAttribute("stroke-dasharray")).toBeTruthy();
    const label = container.querySelector(".chart-refline-label");
    expect(label.textContent).toBe("avg 5");
  });
});

function drugSheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Drug: "Cephalexin", Duration_days: 5 },
    { PatientID: "P2", Drug: "Cephalexin", Duration_days: 7 },
    { PatientID: "P3", Drug: "Nitrofurantoin", Duration_days: 4 },
    { PatientID: "P4", Drug: "Amoxicillin", Duration_days: 6 },
  ]);
}

function makeDrugCountChart() {
  const result = render(<ChartsPanel sheet={drugSheet()} />);
  fireEvent.change(screen.getByPlaceholderText(/organisms in urine/i), { target: { value: "patients by drug" } });
  fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));
  return result;
}

describe("P3-3 ChartsPanel — 'Adjust in words' highlight/reference tweaks end to end", () => {
  it("'highlight cephalexin' colors that bar and updates the Excel recipe", () => {
    const { container } = makeDrugCountChart();
    const tweakBox = screen.getByPlaceholderText(/only top 5/i);
    fireEvent.change(tweakBox, { target: { value: "highlight cephalexin" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(screen.getByRole("status").textContent).toMatch(/Highlighting "Cephalexin"/i);
    const rects = container.querySelectorAll("rect");
    expect([...rects].some((r) => r.getAttribute("fill") === "var(--accent)")).toBe(true);
    expect(screen.getByText(/Match the emphasis/i)).toBeTruthy();
    expect(screen.getByText(/Cephalexin.*stand out/i)).toBeTruthy();
  });

  it("'highlight vancomycin' (not a real category) declines honestly instead of guessing", () => {
    makeDrugCountChart();
    const tweakBox = screen.getByPlaceholderText(/only top 5/i);
    fireEvent.change(tweakBox, { target: { value: "highlight vancomycin" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(screen.getByText(/couldn't find that category/i)).toBeTruthy();
  });

  it("'average' adds a dashed reference line and mentions it in the Excel recipe", () => {
    const { container } = makeDrugCountChart();
    const tweakBox = screen.getByPlaceholderText(/only top 5/i);
    fireEvent.change(tweakBox, { target: { value: "average" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(screen.getByRole("status").textContent).toMatch(/Added a dashed line at the average/i);
    expect(container.querySelector(".chart-refline")).toBeTruthy();
    expect(screen.getByText(/Add a reference line at the average/i)).toBeTruthy();
  });
});
