// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ChartPreview from "./ChartPreview.jsx";

describe("B12 — chart aria-label includes a data summary, not just the chart type", () => {
  it("bar chart aria-label names the values", () => {
    const dataset = { kind: "categorical", points: [{ label: "UTI", value: 3 }, { label: "Pneumonia", value: 2 }], valueName: "count", labelName: "Diagnosis" };
    const { container } = render(<ChartPreview chartType="bar" dataset={dataset} title="count by Diagnosis" />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("aria-label")).toBe("Bar chart of count by Diagnosis: UTI 3, Pneumonia 2");
  });

  it("pie chart aria-label names the values", () => {
    const dataset = { kind: "categorical", points: [{ label: "UTI", value: 3 }, { label: "Pneumonia", value: 2 }] };
    const { container } = render(<ChartPreview chartType="pie" dataset={dataset} />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("aria-label")).toBe("Pie chart: UTI 3, Pneumonia 2");
  });
});
