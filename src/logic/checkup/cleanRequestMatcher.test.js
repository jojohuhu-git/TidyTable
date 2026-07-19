import { describe, it, expect } from "vitest";
import { checkupSheet } from "./scan.js";
import { deriveSheet } from "../workbook.js";
import { matchCleanRequest, cleanRequestMessage } from "./cleanRequestMatcher.js";

function findingsFor(rows) {
  return checkupSheet(deriveSheet("Patients", rows));
}

describe("matchCleanRequest — P2-3 plain-English cleaning box", () => {
  it("matches an exact-duplicate-rows request to the fixable duplicateRows finding", () => {
    const findings = findingsFor([
      { PatientID: "P1", Sex: "M" },
      { PatientID: "P2", Sex: "F" },
      { PatientID: "P1", Sex: "M" }, // exact duplicate of row 1
    ]);
    const result = matchCleanRequest("remove the duplicates", findings);
    expect(result.kind).toBe("matched");
    expect(result.finding.type).toBe("duplicateRows");
    expect(cleanRequestMessage(result)).toBe("Ticked: Duplicate rows.");
  });

  it("recognizes 'duplicates' but reports not-fixable when only repeated IDs exist (no exact duplicate rows)", () => {
    // "SampleID" is deliberately NOT a recognized patient/encounter name —
    // parked item 3 gave CSN/MRN-style columns their own richer findings, so
    // this pins the generic looks-unique path that still owns everything else.
    const findings = findingsFor([
      { SampleID: "P1", Sex: "M" },
      { SampleID: "P2", Sex: "F" },
      { SampleID: "P3", Sex: "M" },
      { SampleID: "P4", Sex: "F" },
      { SampleID: "P5", Sex: "M" },
      { SampleID: "P6", Sex: "F" },
      { SampleID: "P7", Sex: "M" },
      { SampleID: "P8", Sex: "F" },
      { SampleID: "P9", Sex: "M" },
      { SampleID: "P1", Sex: "F" }, // repeated ID, but Sex differs so the row isn't an exact duplicate
    ]);
    const result = matchCleanRequest("remove the duplicates", findings);
    expect(result.kind).toBe("not-fixable");
    expect(result.finding.type).toBe("duplicateIds");
    expect(cleanRequestMessage(result)).toBe(result.finding.detail);
  });

  it("matches 'remove the duplicates' to the optional patient collapse when the column is MRN-like (parked item 3)", () => {
    const findings = findingsFor([
      { PatientID: "P1", Sex: "M" },
      { PatientID: "P2", Sex: "F" },
      { PatientID: "P3", Sex: "M" },
      { PatientID: "P4", Sex: "F" },
      { PatientID: "P1", Sex: "F" }, // same patient, second row
    ]);
    const result = matchCleanRequest("remove the duplicates", findings);
    expect(result.kind).toBe("matched");
    expect(result.finding.type).toBe("duplicatePatientIds");
  });

  it("says so honestly when no duplicates exist", () => {
    const findings = findingsFor([
      { PatientID: "P1", Sex: "M" },
      { PatientID: "P2", Sex: "F" },
    ]);
    const result = matchCleanRequest("remove the duplicates", findings);
    expect(result).toEqual({ kind: "not-found", intent: "duplicates" });
    expect(cleanRequestMessage(result)).toBe("No duplicate rows were found in this sheet.");
  });

  it("asks which column when 'fix the dates' matches more than one date column", () => {
    const findings = findingsFor([
      { PatientID: "P1", StartDate: "01/02/2024", EndDate: "03/04/2024" },
      { PatientID: "P2", StartDate: "05/06/2024", EndDate: "07/08/2024" },
      { PatientID: "P3", StartDate: "09/10/2024", EndDate: "11/12/2024" },
    ]);
    const result = matchCleanRequest("fix the dates", findings);
    expect(result.kind).toBe("ambiguous");
    expect(result.candidates.map((f) => f.column).sort()).toEqual(["EndDate", "StartDate"]);
  });

  it("resolves the ambiguous date request once a column is named", () => {
    const findings = findingsFor([
      { PatientID: "P1", StartDate: "01/02/2024", EndDate: "03/04/2024" },
      { PatientID: "P2", StartDate: "05/06/2024", EndDate: "07/08/2024" },
      { PatientID: "P3", StartDate: "09/10/2024", EndDate: "11/12/2024" },
    ]);
    const result = matchCleanRequest("fix the dates in StartDate", findings);
    expect(result.kind).toBe("matched");
    expect(result.finding.column).toBe("StartDate");
  });

  it("matches a 'turn N/A into blanks' request to the fixable missing-values finding", () => {
    const findings = findingsFor([
      { PatientID: "P1", Notes: "N/A" },
      { PatientID: "P2", Notes: "12" },
      { PatientID: "P3", Notes: "15" },
      { PatientID: "P4", Notes: "N/A" },
      { PatientID: "P5", Notes: "20" },
    ]);
    const result = matchCleanRequest("turn N/A into blanks", findings);
    expect(result.kind).toBe("matched");
    expect(result.finding.type).toBe("missing");
    expect(result.finding.column).toBe("Notes");
  });

  it("reports not-fixable when the only missing-values finding is already-blank cells (nothing to convert)", () => {
    const findings = findingsFor([
      { PatientID: "P1", Notes: "" },
      { PatientID: "P2", Notes: "something" },
      { PatientID: "P3", Notes: "" },
      { PatientID: "P4", Notes: "other" },
    ]);
    const result = matchCleanRequest("turn N/A into blanks", findings);
    expect(result.kind).toBe("not-fixable");
    expect(result.finding.fixable).toBe(false);
    expect(cleanRequestMessage(result)).toMatch(/Nothing to fix automatically/);
  });

  it("resolves a spelling-variant request to the named column when more than one column has variants", () => {
    const findings = findingsFor([
      { PatientID: "P1", Sex: "Male", Race: "white" },
      { PatientID: "P2", Sex: "male", Race: "White" },
      { PatientID: "P3", Sex: "MALE", Race: "black" },
      { PatientID: "P4", Sex: "female", Race: "Black" },
    ]);
    const ambiguous = matchCleanRequest("merge the spellings", findings);
    expect(ambiguous.kind).toBe("ambiguous");
    expect(ambiguous.candidates.map((f) => f.column).sort()).toEqual(["Race", "Sex"]);

    const resolved = matchCleanRequest("merge the spellings of race", findings);
    expect(resolved.kind).toBe("matched");
    expect(resolved.finding.column).toBe("Race");
  });

  it("returns unrecognized for a request outside the four mapped intents", () => {
    const findings = findingsFor([{ PatientID: "P1", Sex: "M" }]);
    const result = matchCleanRequest("reticulate the whatsit", findings);
    expect(result.kind).toBe("unrecognized");
    expect(cleanRequestMessage(result)).toMatch(/Add an AI key/);
  });

  it("returns empty for a blank request", () => {
    expect(matchCleanRequest("   ", [])).toEqual({ kind: "empty" });
  });
});
