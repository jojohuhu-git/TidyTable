import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { deriveSheet } from "../workbook.js";

// Parked item 4 (parked-2026-07-17-brainstormed-queue.md): the Step 3
// pipeline silently dropped a column. "average duration_days by ward and
// diagnosis" answered "broken down by Ward" with "diagnosis" gone — the same
// bug class as R7 (fixed in the chart parser), in this untouched code path.
// Two fixes under test:
//   1. A "by A and B" grouping declines honestly, with runnable one-column
//      alternative phrasings, instead of quietly using only A.
//   2. Generic guardrail: ANY resolved request that names a real column the
//      plan doesn't use can no longer answer as if the word weren't there.
// Averaged crosstabs ("average X by A and B" for real) stay out of scope.

const book = () => ({
  fileName: "f.xlsx",
  sheets: [deriveSheet("Encounters", [
    { PatientID: "P1", Ward: "ICU", Diagnosis: "UTI", Drug: "Ceftriaxone", Duration_days: 5 },
    { PatientID: "P2", Ward: "General", Diagnosis: "Pneumonia", Drug: "Amoxicillin", Duration_days: 3 },
    { PatientID: "P3", Ward: "ICU", Diagnosis: "UTI", Drug: "Ceftriaxone", Duration_days: 7 },
  ])],
});

describe("parked item 4 — two-column group-by declines with alternatives", () => {
  it.each([
    ["average duration_days by ward and diagnosis"],
    ["sum of duration_days by ward and diagnosis"],
    ["how many rows by ward and diagnosis"],
    ["median duration_days by ward & diagnosis"],
    ["average duration_days per ward and diagnosis"],
  ])("%s declines instead of silently dropping a column", (q) => {
    const res = runOffline(q, book(), {});
    expect(res.kind).toBe("decline");
    expect(res.reason).toBe("two-column-group");
    expect(res.message).toMatch(/one column at a time/i);
    expect(res.message).toContain("Ward");
    expect(res.message).toContain("Diagnosis");
  });

  it("offers one-column alternatives that actually answer", () => {
    const res = runOffline("average duration_days by ward and diagnosis", book(), {});
    expect(res.alternatives).toHaveLength(2);
    expect(res.alternatives.some((a) => /by Ward/i.test(a))).toBe(true);
    expect(res.alternatives.some((a) => /by Diagnosis/i.test(a))).toBe(true);
    for (const alt of res.alternatives) {
      const altRes = runOffline(alt, book(), {});
      expect(altRes.kind).toBe("answer");
    }
  });
});

describe("parked item 4 — generic unused-named-column guardrail", () => {
  it('"most common drug by ward and diagnosis" no longer answers by ranking Ward', () => {
    // Before the fix this ranked "Ward" — dropping BOTH "drug" (the asked-for
    // target) and "diagnosis". Any non-answer outcome is acceptable; an answer
    // that ignores named columns is not.
    const res = runOffline("most common drug by ward and diagnosis", book(), {});
    expect(res.kind).not.toBe("answer");
  });

  it("the guardrail decline names the dropped column in plain English", () => {
    const res = runOffline("most common drug by ward and diagnosis", book(), {});
    if (res.kind === "decline") {
      expect(res.message).toMatch(/Diagnosis|Drug/);
      expect(res.message).toMatch(/doesn'?t use|without/i);
    }
  });

  it('"count of rows by ward, diagnosis" still refuses to answer as Ward-only', () => {
    const res = runOffline("count of rows by ward, diagnosis", book(), {});
    expect(res.kind).not.toBe("answer");
  });
});

describe("parked item 4 — non-regression: legitimate requests still answer", () => {
  it.each([
    ["average duration_days by ward", "answer"],
    ["how many rows have UTI in Diagnosis?", "answer"],
    ["how many rows have UTI?", "answer"],
    ["most common Drug", "answer"],
    ["of rows with UTI, how many are in ICU?", "answer"],
  ])("%s -> %s", (q, kind) => {
    const res = runOffline(q, book(), {});
    expect(res.kind).toBe(kind);
  });

  it("a counting noun that matches no real column never trips the guardrail", () => {
    // "patients" is a counting word, not a column, in this workbook.
    const res = runOffline("how many patients have UTI?", book(), {});
    expect(["answer", "clarify-grain"]).toContain(res.kind);
  });
});
