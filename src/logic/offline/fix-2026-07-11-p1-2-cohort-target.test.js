import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";

// Fix spec P1-2 (R4): "average duration for UTI" used to dead-end with "I
// couldn't tell which column of numbers to average" — because "for UTI" is not a
// recognized cohort marker, so "UTI" stayed glued to the target phrase ("duration
// uti") and broke the column match. Now a trailing "for <value>" / "in <value>"
// that names a REAL cell value is peeled off as a cohort filter, so the target
// (Duration_days) resolves and the average is taken over just those rows.
const wb = () => buildExampleWorkbook();

// Example Encounters: UTI rows are P1 (Duration 10) and P3 (Duration 5).
// Mean duration for UTI = (10 + 5) / 2 = 7.5 over n = 2 (the N/A rows are cystitis).
describe("P1-2 — cohort + fuzzy aggregation target (R4)", () => {
  it('R4: "average duration for UTI" resolves the target AND applies the cohort', () => {
    const res = runOffline("average duration for UTI", wb(), {});
    expect(res.kind).toBe("answer");
    expect(res.exec.targetColumn).toBe("Duration_days");
    expect(res.exec.mean).toBe(7.5);
    expect(res.exec.n).toBe(2);
    expect(res.lookedFor).toMatch(/UTI/i);
  });

  it('"average duration in UTI" works the same (in-marker)', () => {
    const res = runOffline("average duration in UTI", wb(), {});
    expect(res.kind).toBe("answer");
    expect(res.exec.targetColumn).toBe("Duration_days");
    expect(res.exec.mean).toBe(7.5);
  });

  it('a trailing "for <value> patients" noun is tolerated', () => {
    const res = runOffline("average duration for UTI patients", wb(), {});
    expect(res.kind).toBe("answer");
    expect(res.exec.mean).toBe(7.5);
  });

  it("the Excel recipe reflects the UTI cohort filter", () => {
    const res = runOffline("average duration for UTI", wb(), {});
    const txt = res.plan.excel_steps.map((s) => `${s.title} ${s.instruction} ${s.formula}`).join(" ");
    expect(txt).toMatch(/UTI/i);
    expect(txt.toLowerCase()).toMatch(/duration_days/);
  });

  it("a trailing phrase that is NOT a real value does not get faked into a cohort", () => {
    // "for narnia" is not a cell value anywhere — the honest outcome is the
    // capability decline, never a guessed cohort.
    const res = runOffline("average duration for narnia", wb(), {});
    expect(res.kind).not.toBe("answer");
  });

  it("plain 'average duration' (no cohort) is unchanged — still 6.75 over n=4", () => {
    const res = runOffline("average duration", wb(), {});
    expect(res.kind).toBe("answer");
    expect(res.exec.mean).toBe(6.75);
    expect(res.exec.n).toBe(4);
  });
});
