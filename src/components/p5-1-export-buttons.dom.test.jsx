// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import ResultsPanel from "./ResultsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P5-1: zero-dependency export buttons — UI layer. Copy chart / Download SVG
// alongside the existing PNG download in Step 9, and "Copy table for Word"
// on every result card (which includes Table 1 — its rows flow through the
// same ResultsPanel).

function sheet() {
  return deriveSheet("D", [{ Dx: "UTI" }, { Dx: "UTI" }, { Dx: "pneumonia" }]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("P5-1 — chart export buttons in Step 9", () => {
  it("offers Copy chart, Download SVG, and the existing PNG download once a chart is up", () => {
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Dx" } });
    expect(screen.getByRole("button", { name: /copy chart/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /download svg/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /download chart as image/i })).toBeTruthy();
  });

  it("Copy chart reports an honest failure message when the browser can't copy images", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Dx" } });
    fireEvent.click(screen.getByRole("button", { name: /copy chart/i }));
    await waitFor(() => {
      expect(screen.getByText(/couldn't copy|isn't available/i)).toBeTruthy();
    });
  });
});

describe("P5-1 — Copy table for Word on a result card", () => {
  const plan = { engine: "offline", summary: "Counted rows per Diagnosis.", looked_for: "Rows per Diagnosis" };
  const rows = [
    { Diagnosis: "UTI", Count: 2 },
    { Diagnosis: "pneumonia", Count: 1 },
  ];

  it("copies the table as real HTML (text/html) so Word keeps the structure", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const captured = [];
    vi.stubGlobal("ClipboardItem", class { constructor(items) { captured.push(items); } });
    vi.stubGlobal("navigator", { clipboard: { write } });

    render(<ResultsPanel plan={plan} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /copy table for word/i }));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(Object.keys(captured[0])).toContain("text/html");
    expect(Object.keys(captured[0])).toContain("text/plain");
    const html = await new Response(captured[0]["text/html"]).text();
    expect(html).toContain("<table");
    expect(html).toContain("<td>UTI</td>");
    await waitFor(() => expect(screen.getByText(/copied/i)).toBeTruthy());
  });

  it("is disabled when there are no rows to copy", () => {
    render(<ResultsPanel plan={plan} rows={[]} />);
    const btn = screen.getByRole("button", { name: /copy table for word/i });
    expect(btn.disabled).toBe(true);
  });
});
