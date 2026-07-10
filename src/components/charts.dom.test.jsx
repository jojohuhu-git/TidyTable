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

  // W4 (owner's decision): many categories no longer refuse — they draw as a
  // horizontal all-rows bar chart, every category labeled, so nothing is
  // hidden. Grouping the smallest into "Other" is offered, never forced.
  it("draws a horizontal all-rows bar chart for many categories instead of refusing", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ Ward: `Ward ${i}`, Cost: i + 1 }));
    const sheet = deriveSheet("D", rows);
    const { container } = render(<ChartsPanel sheet={sheet} />);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Ward" } });

    // A bar chart is drawn (not refused), and every one of the 40 categories
    // gets its own bar rect — the SVG grows taller rather than dropping rows.
    const img = screen.getByRole("img", { name: /bar chart/i });
    expect(img).toBeTruthy();
    expect(container.querySelectorAll("rect").length).toBe(40);
    expect(Number(img.getAttribute("height"))).toBeGreaterThan(300);

    // The recommendation names the horizontal layout, and "Other" grouping is
    // offered as an optional, unchecked checkbox.
    expect(screen.getByText(/Recommended: horizontal bar chart/i)).toBeTruthy();
    const otherToggle = screen.getByRole("checkbox", { name: /Other/i });
    expect(otherToggle.checked).toBe(false);
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
