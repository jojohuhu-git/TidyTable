import { describe, it, expect } from "vitest";
import { resolveChartRequest } from "./textToChart.js";
import { deriveSheet } from "../workbook.js";

// Phase 1 honesty bug 2 (plan-2026-07-10-offline-smarts.md): "duration by
// diagnosis" silently drew a COUNT by Diagnosis — the word "duration" was
// dropped, and the resulting chart looked plausible and was wrong. Leftover
// words that name a NUMERIC column now flip the read to "average of that
// column?" flagged stretched, so the UI confirms before drawing.

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10 },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 7 },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 5 },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3 },
  ]);
}

describe("Bug 2 — chart free text never silently drops a numeric column word", () => {
  it('"duration by diagnosis" flips to average-of-Duration_days and confirms', () => {
    const res = resolveChartRequest("duration by diagnosis", sheet());
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Diagnosis");
    expect(res.aggMode).toBe("average");
    expect(res.valueCol).toBe("Duration_days");
    // Never a silent guess: the flip is a stretch the UI must confirm.
    expect(res.confidence).toBe("stretched");
    expect(res.lookedFor).toMatch(/average of "Duration_days"/);
  });

  it("an explicit aggregation word still resolves exactly as before", () => {
    const res = resolveChartRequest("average duration_days by diagnosis", sheet());
    expect(res.aggMode).toBe("average");
    expect(res.valueCol).toBe("Duration_days");
    expect(res.confidence).toBe("exact");
  });

  it("a plain count request does not flip", () => {
    const res = resolveChartRequest("how many patients by diagnosis", sheet());
    expect(res.aggMode).toBe("count");
    expect(res.valueCol).toBeNull();
  });

  it('a leftover word naming a TEXT column ("drug by diagnosis") is said, not dropped', () => {
    const res = resolveChartRequest("drug by diagnosis", sheet());
    expect(res.status).toBe("resolved");
    expect(res.aggMode).toBe("count");
    // The unplaceable column word is reported so the user sees it was left out.
    expect(res.ignored).toBe("drug");
  });
});
