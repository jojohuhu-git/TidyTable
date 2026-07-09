// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import ChartPreview from "./ChartPreview.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P1-6: ChartPreview's bar/line/scatter charts used to spread a large array
// into Math.max(...arr), which throws on real-sized data. Render the full
// panel end to end on a big dataset to prove the crash is gone, not just the
// underlying math function.
describe("ChartsPanel — renders without crashing on a large scatter dataset", () => {
  it("builds and renders a 50,000-row scatter without throwing", () => {
    const rows = Array.from({ length: 50000 }, (_, i) => ({ Age: i % 100, LOS: (i * 7) % 50 }));
    const sheet = deriveSheet("D", rows);
    render(<ChartsPanel sheet={sheet} />);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Age" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "LOS" } });

    expect(screen.getByRole("img", { name: /scatter plot/i })).toBeTruthy();
    expect(screen.getByText(/showing a sample of/i)).toBeTruthy();
  });

  it("declines plainly instead of rendering hundreds of bars", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ PatientID: `P${i}`, Cost: i }));
    const sheet = deriveSheet("D", rows);
    render(<ChartsPanel sheet={sheet} />);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "PatientID" } });

    expect(screen.getByText(/200 categories/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("ChartPreview — P2-15 pie/bar edge cases", () => {
  it("draws a full circle (not an invisible zero-length arc) for a single 100% slice", () => {
    const dataset = { kind: "categorical", points: [{ label: "All", value: 10 }] };
    const { container } = render(<ChartPreview chartType="pie" dataset={dataset} />);
    expect(container.querySelector("circle")).toBeTruthy();
    expect(container.querySelector("path")).toBeNull();
    expect(screen.getByText(/All \(100%\)/)).toBeTruthy();
  });

  it("renders a negative-value bar growing left of a zero axis instead of a clamped sliver", () => {
    const dataset = { kind: "categorical", points: [{ label: "Gain", value: 5 }, { label: "Loss", value: -5 }] };
    const { container } = render(<ChartPreview chartType="bar" dataset={dataset} highlightLabel={null} />);
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBe(2);
    const gainX = Number(rects[0].getAttribute("x"));
    const lossX = Number(rects[1].getAttribute("x"));
    // Equal-magnitude opposite values should sit on either side of the same zero axis.
    expect(lossX).toBeLessThan(gainX);
    expect(container.querySelector("line")).toBeTruthy(); // zero axis drawn
  });
});
