// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import CheckupPanel from "./components/CheckupPanel.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import App from "./App.jsx";
import { deriveSheet } from "./logic/workbook.js";

// Parked item 3 UI layer. All fixtures are synthetic — never real patient data.

function encounterSheet() {
  return deriveSheet("Encounters", [
    { CSN: "1001", Ward: "ICU", Drug: "cefepime" },
    { CSN: "1002", Ward: "Peds", Drug: "amoxicillin" },
    { CSN: "1001", Ward: "ICU", Drug: "cefepime" }, // exact copy
    { CSN: "1003", Ward: "Peds", Drug: "ceftriaxone" },
    { CSN: "1003", Ward: "NICU", Drug: "ceftriaxone" }, // same CSN, differs
  ]);
}

function patientSheet() {
  return deriveSheet("Visits", [
    { MRN: "M1", Visit_date: "2026-01-05", Ward: "ICU" },
    { MRN: "M1", Visit_date: "2026-02-01", Ward: "Peds" },
    { MRN: "M2", Visit_date: "2026-01-10", Ward: "Peds" },
  ]);
}

describe("parked 3 — Step 2 encounter-ID card", () => {
  it("shows the warning, the one-click removal fix, and a side-by-side preview of differing rows", () => {
    render(<CheckupPanel sheets={[encounterSheet()]} busy={false} onApply={vi.fn()} />);
    expect(screen.getByText(/Repeated encounter IDs in "CSN"/i)).toBeInTheDocument();
    // Differing rows for CSN 1003 render side by side in the expander.
    const preview = screen.getByTestId("differing-group-1003");
    expect(within(preview).getByText("Peds")).toBeInTheDocument();
    expect(within(preview).getByText("NICU")).toBeInTheDocument();
  });

  it("applies the one-click exact-copy removal", () => {
    const onApply = vi.fn();
    render(<CheckupPanel sheets={[encounterSheet()]} busy={false} onApply={onApply} />);
    const card = screen.getByText(/Repeated encounter IDs in "CSN"/i).closest("li");
    fireEvent.click(within(card).getByRole("checkbox"));
    fireEvent.click(screen.getByText(/Apply 1 selected fix/i));
    expect(onApply).toHaveBeenCalledTimes(1);
    const fixes = onApply.mock.calls[0][0];
    expect(fixes).toHaveLength(1);
    expect(fixes[0].normalizer).toBe("dedupeEncounters");
    expect(fixes[0].column).toBe("CSN");
  });
});

describe("parked 3 — Step 2 patient-ID card", () => {
  it("asks which row survives, then applies the chosen policy", () => {
    const onApply = vi.fn();
    render(<CheckupPanel sheets={[patientSheet()]} busy={false} onApply={onApply} />);
    const card = screen.getByText(/The same patient appears on several rows/i).closest("li");
    fireEvent.click(within(card).getByRole("checkbox"));
    // The survivor question appears; nothing is selected until it's answered.
    expect(screen.getByText(/Which row should survive for each patient in "MRN"\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/most recent row by "Visit_date"/i));
    fireEvent.click(screen.getByText(/Apply 1 selected fix/i));
    const fixes = onApply.mock.calls[0][0];
    expect(fixes[0].normalizer).toBe("keepOnePerPatient");
    expect(fixes[0].params.policy).toBe("last::Visit_date");
  });
});

describe("parked 3 — removed rows stay inspectable", () => {
  it("shows the removed rows on the result card", async () => {
    const { default: ResultsListPanel } = await import("./components/ResultsListPanel.jsx");
    const results = [{
      id: "r1",
      kind: "checkup",
      label: "Result of: 1 checkup fix",
      answer: "4 rows cleaned — 1 removed",
      timestamp: Date.now(),
      plan: { summary: "s", excel_steps: [], r_script: "", r_run_notes: "" },
      resultRows: [{ CSN: "1002", Ward: "Peds" }],
      removedRows: [{ CSN: "1001", Ward: "ICU" }],
      savedToRoutine: true,
    }];
    render(<ResultsListPanel results={results} expandedId="r1" onToggle={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/See the 1 removed row \(undo restores them\)/i)).toBeInTheDocument();
    expect(screen.getByText("1001")).toBeInTheDocument();
  });
});

describe("parked 3 — PHI mode", () => {
  beforeEach(() => localStorage.clear());

  it("disables the whole-spreadsheet AI option while PHI mode is on", () => {
    render(
      <UploadPanel
        workbook={{ fileName: "t.xlsx", sheets: [patientSheet()] }}
        onWorkbook={vi.fn()}
        excluded={new Set()}
        setExcluded={vi.fn()}
        privacyMode="sample"
        setPrivacyMode={vi.fn()}
        phiMode={true}
        setPhiMode={vi.fn()}
      />,
    );
    const fullRadio = screen.getByRole("radio", { name: /whole spreadsheet/i });
    expect(fullRadio).toBeDisabled();
  });

  it("stops persisting the results list and remembers the toggle", () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    const phiToggle = screen.getByRole("checkbox", { name: /PHI mode/i });
    fireEvent.click(phiToggle);
    expect(localStorage.getItem("tidytable_phi_mode")).toBe("1");
    const saved = JSON.parse(localStorage.getItem("tidytable_session_v1") || "{}");
    expect(saved.results).toEqual([]);
  });
});
