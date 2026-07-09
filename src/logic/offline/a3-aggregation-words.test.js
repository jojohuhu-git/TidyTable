// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { matchRequest } from "./matcher.js";
import { runOffline } from "./runOffline.js";
import { deriveSheet } from "../workbook.js";
import { listMisses, clearMisses } from "./missLog.js";

function book() {
  const enc = deriveSheet("Encounters", [
    { Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, PatientID: "P1" },
    { Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 5, PatientID: "P2" },
  ]);
  return { fileName: "m.xlsx", sheets: [enc] };
}

// A3 Level 1: "average"/"sum"/"per X"/"by X" used to fall through to
// resolveCondition and come back as an undefined clinical term ("add a
// Definitions row for 'average'") — no Definitions row could ever satisfy
// that, since the engine has no average/sum/group-by math at all (see
// fillPlan.js). These must decline honestly instead, and log to the miss log
// the same way any other unsupported request does.
describe("A3 Level 1 — aggregation/group words decline honestly, not as missing definitions", () => {
  beforeEach(() => clearMisses());

  it("a bare average request declines as unsupported-average, not needs_definitions", () => {
    const result = matchRequest("average duration_days per patient", book(), { present: false });
    expect(result.status).toBe("none");
    expect(result.reason).toBe("unsupported-average");
  });

  it("a bare sum/total request declines as unsupported-sum", () => {
    const result = matchRequest("sum of patients with UTI", book(), { present: false });
    expect(result.status).toBe("none");
    expect(result.reason).toBe("unsupported-sum");
  });

  it("a count with a per-group breakdown declines as unsupported-groupby", () => {
    const result = matchRequest("how many patients per diagnosis", book(), { present: false });
    expect(result.status).toBe("none");
    expect(result.reason).toBe("unsupported-groupby");
  });

  it("'by' and 'grouped by' group-by phrasing both decline the same way", () => {
    expect(matchRequest("count by diagnosis", book(), { present: false }).reason).toBe("unsupported-groupby");
    expect(matchRequest("how many patients grouped by diagnosis", book(), { present: false }).reason).toBe("unsupported-groupby");
  });

  it("runOffline gives an honest capability message and logs the miss, not a Definitions-row prompt", () => {
    const res = runOffline("average duration_days per patient", book(), {});
    expect(res.kind).toBe("decline");
    expect(res.message).toMatch(/average/i);
    expect(res.message).not.toMatch(/Definitions/i);
    const misses = listMisses();
    expect(misses).toHaveLength(1);
    expect(misses[0].reason).toBe("unsupported-average");
  });

  it("does not regress a genuinely resolvable request that merely contains the word 'by'", () => {
    const result = matchRequest("how many patients with UTI treated by cephalexin", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.stages).toHaveLength(2);
  });

  it("does not regress a genuinely undefined clinical term that happens to contain 'by' mid-sentence", () => {
    const result = matchRequest("how many patients with a diagnosis confirmed by biopsy", book(), { present: false });
    expect(result.status).toBe("needs_definitions");
  });
});
