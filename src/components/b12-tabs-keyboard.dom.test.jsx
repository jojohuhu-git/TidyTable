// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResultsPanel from "./ResultsPanel.jsx";
import UploadPanel from "./UploadPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

describe("B12 — ResultsPanel tabs support arrow-key navigation and aria-controls", () => {
  const plan = {
    looked_for: "test",
    engine: "offline",
    summary: "summary text",
    excel_steps: [],
    r_script: "# script",
    r_run_notes: "notes",
  };

  it("ArrowRight moves focus and selects the next tab", () => {
    render(<ResultsPanel plan={plan} rows={[{ a: 1 }]} />);
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });

  it("ArrowLeft from the first tab wraps to the last tab", () => {
    render(<ResultsPanel plan={plan} rows={[{ a: 1 }]} />);
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs[tabs.length - 1]).toHaveFocus();
  });

  it("each tab has aria-controls pointing at an existing tabpanel", () => {
    render(<ResultsPanel plan={plan} rows={[{ a: 1 }]} />);
    const tabs = screen.getAllByRole("tab");
    for (const tab of tabs) {
      const controlsId = tab.getAttribute("aria-controls");
      expect(controlsId).toBeTruthy();
      if (tab.getAttribute("aria-selected") === "true") {
        expect(document.getElementById(controlsId)).toBeTruthy();
      }
    }
  });
});

describe("B12 — UploadPanel sheet tabs support arrow-key navigation", () => {
  it("ArrowRight moves focus and selects the next sheet tab", () => {
    const workbook = {
      fileName: "m.xlsx",
      sheets: [deriveSheet("Sheet1", [{ A: 1 }]), deriveSheet("Sheet2", [{ B: 2 }])],
    };
    render(
      <UploadPanel
        workbook={workbook}
        onWorkbook={() => {}}
        excluded={new Set()}
        setExcluded={() => {}}
        privacyMode="sample"
        setPrivacyMode={() => {}}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Preview of/).textContent).toMatch(/Sheet2/);
  });
});
