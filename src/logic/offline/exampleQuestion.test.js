import { describe, it, expect } from "vitest";
import { buildOfflineExample } from "./exampleQuestion.js";
import { matchRequest } from "./matcher.js";
import { deriveSheet } from "../workbook.js";

// A4: the example question must be genuinely answerable offline, not just
// plausible-looking — verify every case round-trips through matchRequest().
describe("buildOfflineExample — a real, verified offline-answerable example", () => {
  it("returns null when there is no workbook or no rows", () => {
    expect(buildOfflineExample(null)).toBeNull();
    expect(buildOfflineExample({ sheets: [] })).toBeNull();
    expect(buildOfflineExample({ sheets: [deriveSheet("Empty", [])] })).toBeNull();
  });

  it("builds a question that matchRequest resolves confidently", () => {
    const enc = deriveSheet("Encounters", [
      { Diagnosis: "UTI", PatientID: "P1" },
      { Diagnosis: "UTI", PatientID: "P2" },
      { Diagnosis: "pneumonia", PatientID: "P3" },
    ]);
    const workbook = { fileName: "m.xlsx", sheets: [enc] };
    const text = buildOfflineExample(workbook);
    expect(typeof text).toBe("string");
    const match = matchRequest(text, workbook, { present: false });
    expect(match.status).toBe("confident");
  });

  it("prefers a value that repeats across rows over a one-off value", () => {
    const enc = deriveSheet("Encounters", [
      { Diagnosis: "UTI", PatientID: "P1" },
      { Diagnosis: "UTI", PatientID: "P2" },
      { Diagnosis: "UTI", PatientID: "P3" },
      { Diagnosis: "raresyndrome", PatientID: "P4" },
    ]);
    const workbook = { fileName: "m.xlsx", sheets: [enc] };
    const text = buildOfflineExample(workbook);
    expect(text.toLowerCase()).toContain("uti");
  });

  it("skips overly long values and still finds a shorter usable one", () => {
    const enc = deriveSheet("Encounters", [
      { Note: "a".repeat(80), Diagnosis: "UTI", PatientID: "P1" },
      { Note: "a".repeat(80), Diagnosis: "UTI", PatientID: "P2" },
    ]);
    const workbook = { fileName: "m.xlsx", sheets: [enc] };
    const text = buildOfflineExample(workbook);
    expect(text).not.toContain("a".repeat(80));
    const match = matchRequest(text, workbook, { present: false });
    expect(match.status).toBe("confident");
  });
});
