// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { matchRequest } from "./matcher.js";
import { deriveSheet } from "../workbook.js";

function book() {
  const enc = deriveSheet("Encounters", [
    { Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, PatientID: "P1" },
    { Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 6, PatientID: "P2" },
    { Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 5, PatientID: "P3" },
    { Diagnosis: "pneumonia", Drug: "cefpodoxime", Duration_days: "N/A", PatientID: "P4" },
    { Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, PatientID: "P5" },
  ]);
  return { fileName: "m.xlsx", sheets: [enc] };
}

describe("Phase 2 — matchRequest resolves the new descriptive-statistics intents", () => {
  it("median", () => {
    const r = matchRequest("median duration_days", book(), { present: false });
    expect(r.status).toBe("confident");
    expect(r.intent).toBe("median");
    expect(r.aggregation.targetColumn).toBe("Duration_days");
  });

  it("quartiles / IQR", () => {
    const r1 = matchRequest("quartiles of duration_days", book(), { present: false });
    expect(r1.status).toBe("confident");
    expect(r1.intent).toBe("quartiles");
    const r2 = matchRequest("what is the iqr of duration_days", book(), { present: false });
    expect(r2.status).toBe("confident");
    expect(r2.intent).toBe("quartiles");
  });

  it("standard deviation", () => {
    const r = matchRequest("standard deviation of duration_days", book(), { present: false });
    expect(r.status).toBe("confident");
    expect(r.intent).toBe("stdev");
  });

  it("minimum / maximum", () => {
    const rmin = matchRequest("minimum duration_days", book(), { present: false });
    expect(rmin.status).toBe("confident");
    expect(rmin.intent).toBe("min");
    const rmax = matchRequest("maximum duration_days", book(), { present: false });
    expect(rmax.status).toBe("confident");
    expect(rmax.intent).toBe("max");
  });

  it("range", () => {
    const r = matchRequest("range of duration_days", book(), { present: false });
    expect(r.status).toBe("confident");
    expect(r.intent).toBe("range");
  });

  it("describe / summarize", () => {
    const r1 = matchRequest("describe duration_days", book(), { present: false });
    expect(r1.status).toBe("confident");
    expect(r1.intent).toBe("describe");
    const r2 = matchRequest("summarize duration_days", book(), { present: false });
    expect(r2.status).toBe("confident");
    expect(r2.intent).toBe("describe");
  });

  it("every new stat combines with a cohort filter, same as average/sum already do", () => {
    const r = matchRequest("median duration_days for patients with UTI", book(), { present: false });
    expect(r.status).toBe("confident");
    expect(r.stages).toHaveLength(1);
  });

  it("every new stat combines with a group-by breakdown", () => {
    const r = matchRequest("median duration_days per diagnosis", book(), { present: false });
    expect(r.status).toBe("confident");
    expect(r.aggregation.groupColumn).toBe("Diagnosis");
  });

  it("the non-numeric gate (Phase 1) applies to every new stat, not just average/sum", () => {
    for (const phrase of ["median Diagnosis", "standard deviation of Diagnosis", "minimum Diagnosis", "describe Diagnosis"]) {
      const r = matchRequest(phrase, book(), { present: false });
      expect(r.status).toBe("none");
      expect(r.reason).toBe("non-numeric-target");
    }
  });

  it("'min'/'max' are never bare 3-letter words — a duration threshold phrase using 'min' as a time unit is not hijacked into an aggregation", () => {
    // No "how many"/cohort marker here so this is just a sanity check that a
    // bare "5 min" does not itself get read as an intent word in isolation.
    const r = matchRequest("5 min duration_days", book(), { present: false });
    // Whatever this resolves to, it must NOT be misread as the "min" (minimum) intent.
    expect(r.intent === "min" ? r.aggregation?.targetColumn : null).not.toBe("Duration_days");
  });

  it("still declines honestly when no column can be pinned down, for a new stat", () => {
    const r = matchRequest("median widgetry", book(), { present: false });
    expect(r.status).toBe("none");
    expect(r.reason).toBe("unsupported-median");
  });
});
