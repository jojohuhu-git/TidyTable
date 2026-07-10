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
// that, since the engine originally had no average/sum/group-by math at all.
// These declined honestly instead of asking for a definition, logging to the
// miss log the same way any other unsupported request does.
//
// A3 Level 2 (see a3-level2-aggregation.test.js) then built the real math:
// group-by breakdowns and offline sum/average/distinct now resolve
// confidently whenever a real column can be pinned down for them — the two
// group-by cases below flipped from "declines" to "answers" as a result.
// What's left declining here is genuinely unresolvable: no column named in
// the request maps to a real header, so there's still nothing to compute.
describe("A3 Level 1 — aggregation/group words decline honestly, not as missing definitions", () => {
  beforeEach(() => clearMisses());

  it("a bare average request with no resolvable target column still declines as unsupported-average, not needs_definitions", () => {
    // "duration_days per patient" as one phrase doesn't fuzzy-match any
    // header (the "per patient" residue breaks the target-column match) —
    // a genuinely unresolvable aggregation still declines honestly.
    const result = matchRequest("average duration_days per patient", book(), { present: false });
    expect(result.status).toBe("none");
    expect(result.reason).toBe("unsupported-average");
  });

  it("a bare sum/total request with no numeric target still declines as unsupported-sum", () => {
    const result = matchRequest("sum of patients with UTI", book(), { present: false });
    expect(result.status).toBe("none");
    expect(result.reason).toBe("unsupported-sum");
  });

  it("A3 Level 2: a count with a per-group breakdown now answers with one row per group, not a decline", () => {
    const result = matchRequest("how many patients per diagnosis", book(), { present: false });
    expect(result.status).toBe("confident");
    expect(result.groupColumn).toBe("Diagnosis");
    expect(result.stages).toHaveLength(0);
  });

  it("A3 Level 2: 'by' and 'grouped by' group-by phrasing both resolve the same way", () => {
    expect(matchRequest("count by diagnosis", book(), { present: false }).groupColumn).toBe("Diagnosis");
    expect(matchRequest("how many patients grouped by diagnosis", book(), { present: false }).groupColumn).toBe("Diagnosis");
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
