import { describe, it, expect } from "vitest";
import { resolveChartRequest } from "./textToChart.js";
import { deriveSheet } from "../workbook.js";

// P3-2 (fix-2026-07-11-steps-2-3-9-plain-english.md): R7 — "compare drug use
// between diagnoses" used to resolve to "count of rows across Drug" marked
// EXACT, with "between diagnoses" silently buried in a footnote shown only
// after the (wrong-for-the-ask) chart was already drawn. P3-2's interim fix
// was to decline plainly instead of drawing the wrong chart.
//
// SUPERSEDED (P6-1, 2026-07-17): the interim decline is gone — these same
// requests now resolve to real grouped/stacked bars. See
// p6-1-grouped-stacked-charts.test.js for the current (crosstab-resolving)
// behavior of the three tests that used to assert a decline here. This file
// now only keeps the two non-regression cases that were never about the
// two-column decline in the first place.

describe("P3-2 non-regression (surviving after P6-1 superseded the decline)", () => {
  it("a genuinely single-column request still resolves normally (no regression)", () => {
    const res = resolveChartRequest("patients by ward", deriveSheet("E", [
      { PatientID: "P1", Ward: "ICU" },
      { PatientID: "P2", Ward: "General" },
    ]));
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Ward");
    expect(res.confidence).toBe("exact");
  });

  it("a leftover word that ISN'T a real column stays a soft, honest note (not a two-column crosstab)", () => {
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
