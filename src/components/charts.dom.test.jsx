// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
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
