import { describe, it, expect } from "vitest";
import { resolveChartRequest } from "./textToChart.js";
import { deriveSheet } from "../workbook.js";

// P3-2 (fix-2026-07-11-steps-2-3-9-plain-english.md): R7 — "compare drug use
// between diagnoses" used to resolve to "count of rows across Drug" marked
// EXACT, with "between diagnoses" silently buried in a footnote shown only
// after the (wrong-for-the-ask) chart was already drawn. Until P6-1 ships
// real two-column (grouped/stacked) charts, any request that names a second
// real column must decline plainly up front — never draw a one-column chart
// and call it exact.

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10 },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 7 },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 5 },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3 },
  ]);
}

describe("P3-2 — honest interim decline for two-column chart requests", () => {
  it('R7: "compare drug use between diagnoses" declines, naming both columns', () => {
    const res = resolveChartRequest("compare drug use between diagnoses", sheet());
    expect(res.status).toBe("none");
    expect(res.reason).toBe("two-column");
    expect(res.message).toMatch(/compares two things at once/i);
    expect(res.message).toMatch(/Drug/);
    expect(res.message).toMatch(/Diagnosis/);
    expect(res.message).toMatch(/Step 7/);
  });

  it('"Drug and Diagnosis" declines the same way', () => {
    const res = resolveChartRequest("Drug and Diagnosis", sheet());
    expect(res.status).toBe("none");
    expect(res.reason).toBe("two-column");
    expect(res.message).toMatch(/Drug/);
    expect(res.message).toMatch(/Diagnosis/);
  });

  it('"drug by diagnosis" (explicit grouping marker) also declines, not a silent one-column chart', () => {
    const res = resolveChartRequest("drug by diagnosis", sheet());
    expect(res.status).toBe("none");
    expect(res.reason).toBe("two-column");
    expect(res.message).toMatch(/Diagnosis/);
    expect(res.message).toMatch(/Drug/);
  });

  it("a genuinely single-column request still resolves normally (no regression)", () => {
    const res = resolveChartRequest("patients by ward", deriveSheet("E", [
      { PatientID: "P1", Ward: "ICU" },
      { PatientID: "P2", Ward: "General" },
    ]));
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Ward");
    expect(res.confidence).toBe("exact");
  });

  it("a leftover word that ISN'T a real column stays a soft, honest note (not a two-column decline)", () => {
    // "escherichia coli" already resolves as a VALUE filter on Urine Organisms
    // (findValueCandidates wins), so this must stay a resolved plan, not decline.
    const s = deriveSheet("E", [
      { PatientID: "P1", "Urine Organisms": "ESCHERICHIA COLI", Ward: "ICU" },
      { PatientID: "P2", "Urine Organisms": "KLEBSIELLA PNEUMONIAE", Ward: "General" },
    ]);
    const res = resolveChartRequest("escherichia coli by ward", s);
    expect(res.status).toBe("resolved");
    expect(res.filter).toEqual({ column: "Urine Organisms", value: "ESCHERICHIA COLI" });
  });
});
