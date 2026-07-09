import { describe, it, expect } from "vitest";
import { matchRequest } from "./matcher.js";
import { runOffline } from "./runOffline.js";
import { deriveSheet } from "../workbook.js";

function book() {
  const enc = deriveSheet("Encounters", [
    { Diagnosis: "UTI", Duration_days: 10, PatientID: "P1" },
    { Diagnosis: "UTI", Duration_days: 5, PatientID: "P2" },
    { Diagnosis: "UTI", Duration_days: 3, PatientID: "P3" },
    { Diagnosis: "pneumonia", Duration_days: 9, PatientID: "P4" },
    { Diagnosis: "UTI", Duration_days: 12, PatientID: "P5" },
  ]);
  return { fileName: "m.xlsx", sheets: [enc] };
}

// A2: a compound question must not silently drop one of its conditions.
describe("A2 — compound questions resolve every condition, never truncate", () => {
  it("resolves both the diagnosis filter and the duration threshold from a single compound sentence", () => {
    const result = matchRequest("how many patients with UTI had duration_days over 7", book(), { present: false });
    expect(result.status).toBe("confident");
    // Two AND-ed stages: Diagnosis = UTI, then Duration_days > 7.
    expect(result.stages).toHaveLength(2);
    const kinds = result.stages.map((s) => s.condition.kind);
    expect(kinds).toContain("value");
    expect(kinds).toContain("threshold");
    const threshold = result.stages.find((s) => s.condition.kind === "threshold").condition;
    expect(threshold.column).toBe("Duration_days");
    expect(threshold.op).toBe(">");
    expect(threshold.value).toBe(7);
  });

  it("the resolved compound question answers with the correct count (2, not all 4 UTI rows)", () => {
    const res = runOffline("how many patients with UTI had duration_days over 7", book(), {});
    expect(res.kind).toBe("answer");
    const lastLevel = res.exec.levels[res.exec.levels.length - 1];
    expect(lastLevel.count).toBe(2); // P1 (10) and P5 (12) are UTI with duration > 7
  });

  it("the already-working nested 'of those' form still works", () => {
    const result = matchRequest("of patients with UTI, and of those, how many had duration_days over 7", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.stages).toHaveLength(2);
  });

  it("a clean single-condition question still resolves to exactly one stage", () => {
    const result = matchRequest("how many patients with pneumonia", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0].condition.kind).toBe("value");
  });

  it("refuses rather than truncates when the residue genuinely cannot be resolved", () => {
    const result = matchRequest("how many patients with UTI had some unrecognizable clinical nonsense over 7", book(), { present: false });
    // Either resolves the residue into a second condition, or refuses as
    // partial/needs_definitions — but must NEVER silently answer using only
    // the UTI filter while discarding a comparator+number residue that has
    // nowhere to go.
    if (result.status === "confident") {
      expect(result.stages.length).toBeGreaterThan(1);
    } else {
      expect(["partial", "needs_definitions", "none"]).toContain(result.status);
    }
  });
});
