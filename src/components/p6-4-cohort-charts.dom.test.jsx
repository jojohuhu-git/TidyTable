// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ChartsPanel from "./ChartsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P6-4: cohort-scoped charts get first-class wording — UI layer. Same
// fixture as the logic test: the cystitis cohort's most common drug
// (cephalexin) differs from the whole sheet's (nitrofurantoin), so a passing
// title/callout proves the chart is scoped to the cohort, not the full sheet.
function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "nitrofurantoin", Duration_days: 10 },
    { PatientID: "P2", Diagnosis: "UTI", Drug: "nitrofurantoin", Duration_days: 10 },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "nitrofurantoin", Duration_days: 10 },
    { PatientID: "P4", Diagnosis: "pneumonia", Drug: "azithromycin", Duration_days: 8 },
    { PatientID: "P5", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 5 },
    { PatientID: "P6", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 7 },
    { PatientID: "P7", Diagnosis: "cystitis", Drug: "nitrofurantoin", Duration_days: 10 },
    { PatientID: "P8", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 5 },
  ]);
}

describe("P6-4 — owner's cystitis example (a): filtered ranked bar, top bar emphasized inside the cohort", () => {
  it('"among patients with cystitis, most common drug" draws a bar chart titled and captioned for the cohort, with the callout scoped to it', () => {
    render(<ChartsPanel sheet={sheet()} />);
    const input = screen.getByPlaceholderText(/organisms in urine/i);
    fireEvent.change(input, { target: { value: "among patients with cystitis, most common drug" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));

    expect(screen.getByText(/recommended: bar chart/i)).toBeTruthy();
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/cystitis only/i);
    // The cystitis cohort really does have one nitrofurantoin row (P7), so it
    // legitimately still appears as a smaller bar — what proves the callout
    // is scoped to the cohort (not the whole sheet, where nitrofurantoin
    // would be the most-common drug) is which one is named as "Most common".
    expect(img.getAttribute("aria-label")).toMatch(/cephalexin 3, nitrofurantoin 1/i);
    expect(within(img).getByText(/most common: cephalexin/i)).toBeTruthy();

    expect(screen.getByText(/only counting rows where "diagnosis" is "cystitis", n=4/i)).toBeTruthy();
  });
});

describe("P6-4 — owner's cystitis example (b): 'durations chosen for cystitis' draws the P6-2 histogram filtered to cystitis", () => {
  it("draws a histogram titled and captioned for the cohort, binning only the cystitis rows", () => {
    render(<ChartsPanel sheet={sheet()} />);
    const input = screen.getByPlaceholderText(/organisms in urine/i);
    fireEvent.change(input, { target: { value: "durations chosen for cystitis" } });
    fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));
    // "durations" is a stretched (plural/fold) match to "Duration_days", same
    // as the cohort-free "durations chosen" request — confirm the middle path.
    fireEvent.click(screen.getByRole("button", { name: /Yes, chart that/i }));

    expect(screen.getByText(/recommended: histogram/i)).toBeTruthy();
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/cystitis only/i);
    expect(img.getAttribute("aria-label")).toMatch(/4 values/i);

    expect(screen.getByText(/only counting rows where "diagnosis" is "cystitis", n=4/i)).toBeTruthy();
  });
});
