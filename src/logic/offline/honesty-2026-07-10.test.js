// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { matchRequest } from "./matcher.js";
import { deriveSheet } from "../workbook.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";

// Phase 1 honesty bugs (plan-2026-07-10-offline-smarts.md): three confirmed
// violations of the never-guess promise, found by the 40-phrase novice audits.
// These are "must never regress" — they seed the Phase 6 phrase bank.
//
// Bug 1: "average age" confidently answered 'Averaging "Diagnosis"' (the "s"
//        left over from "what's" substring-matched a header; and average/sum
//        never checked the column held numbers).
// Bug 3: negation words were stop-words, so "did NOT get amoxicillin",
//        "never got", "excluding UTI", and "without UTI" all answered the
//        OPPOSITE question with full confidence.
// (Bug 2, the Step 9 chart flip, is covered in
//  src/logic/charts/honesty-2026-07-10.test.js.)

const wb = () => buildExampleWorkbook();

describe("Bug 1 — average/sum on a non-numeric column refuses, never guesses", () => {
  it('declines "average diagnosis" with a plain words-not-numbers message', () => {
    const res = runOffline("average diagnosis", wb());
    expect(res.kind).toBe("decline");
    expect(res.message).toMatch(/words, not numbers/i);
    expect(res.message).toMatch(/Diagnosis/);
  });

  it('no longer answers "what\'s the average age" by averaging an unrelated column', () => {
    const res = runOffline("what's the average age", wb());
    expect(res.kind).toBe("decline");
    // The decline is honest about the real problem: no column was resolved.
    expect(res.message).toMatch(/couldn't tell which column/i);
  });

  it("still averages a numeric (mixed) column normally", () => {
    const res = runOffline("average duration_days", wb());
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toBe('Averaging "Duration_days".');
  });

  it("a distinct count still works on a text column (no gate)", () => {
    const res = runOffline("how many different diagnoses", wb());
    expect(res.kind).toBe("answer");
  });

  it("a stray single letter can no longer substring-match a column name", () => {
    // "s" (from "what's") used to find "Diagnosi-s-".
    const match = matchRequest("what's the average s", wb(), { present: false });
    expect(match.status).toBe("none");
  });
});

describe("Bug 3 — negation inverts the condition instead of being dropped", () => {
  // Example file drugs: cephalexin, amoxicillin, amoxicillin, cephalexin,
  // cephalexin, cefpodoxime → NOT amoxicillin = 4 of 6 rows.
  it('"did not get amoxicillin" counts the rows WITHOUT the drug', () => {
    const res = runOffline("how many patients did not get amoxicillin", wb(), { grainMode: "row" });
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toMatch(/"Drug" is NOT amoxicillin/);
    expect(res.exec.levels[0].count).toBe(4);
    expect(res.exec.levels[0].denominator).toBe(6);
  });

  it('"never got amoxicillin" per patient means NO row matches (P4 has two rows)', () => {
    // Patients P1..P5; P2 and P3 got amoxicillin → never = 3 of 5.
    const res = runOffline("how many patients never got amoxicillin", wb(), { grainMode: "group-then-test" });
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toMatch(/NOT amoxicillin/);
    expect(res.exec.levels[0].count).toBe(3);
    expect(res.exec.levels[0].denominator).toBe(5);
  });

  it('"excluding UTI" counts the non-UTI rows', () => {
    const res = runOffline("how many patients excluding UTI", wb(), { grainMode: "row" });
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toMatch(/"Diagnosis" is NOT UTI/);
    expect(res.exec.levels[0].count).toBe(4);
  });

  it('"without UTI" no longer splits the cohort marker inside "with-out"', () => {
    const res = runOffline("how many patients without UTI", wb(), { grainMode: "row" });
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toMatch(/NOT UTI/);
    expect(res.exec.levels[0].count).toBe(4);
  });

  it('"not more than 7" flips the comparator instead of dropping the "not"', () => {
    // Duration_days: 10, 7, 5, N/A, N/A, 5 → at most 7 = 3 rows, 2 unreadable.
    const res = runOffline("how many patients with duration_days not more than 7", wb(), { grainMode: "row" });
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toMatch(/at most 7/);
    expect(res.exec.levels[0].count).toBe(3);
  });

  it("a negation word that attaches to nothing blocks, never drops", () => {
    const res = runOffline("how many patients did not", wb(), { grainMode: "row" });
    expect(res.kind).not.toBe("answer");
  });

  it('a literal cell value containing a negation word ("No growth") still matches itself', () => {
    const sheet = deriveSheet("Cultures", [
      { PatientID: "P1", Result: "No growth" },
      { PatientID: "P2", Result: "ESCHERICHIA COLI" },
      { PatientID: "P3", Result: "No growth" },
    ]);
    const res = runOffline("how many rows with no growth", { fileName: "c.xlsx", sheets: [sheet] });
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toMatch(/"Result" is No growth/);
    expect(res.lookedFor).not.toMatch(/NOT/);
    expect(res.exec.levels[0].count).toBe(2);
  });

  it("the Excel step and worker transform reproduce the negated count", () => {
    const book = wb();
    const res = runOffline("how many patients did not get amoxicillin", book, { grainMode: "row" });
    // Excel: COUNTIFS with a "<>" criterion, same rows the app counted.
    expect(res.plan.excel_steps[0].formula).toContain('"<>amoxicillin"');
    // Worker transform (replays on new data) computes the same 4 of 6.
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", res.plan.transform_code);
    const out = fn({ [book.sheets[0].name]: book.sheets[0].rows });
    expect(out[0]["Matched"]).toBe(4);
    expect(out[0]["Out of"]).toBe(6);
  });

  it('the worker transform reproduces the per-patient "never" count too', () => {
    const book = wb();
    const res = runOffline("how many patients never got amoxicillin", book, { grainMode: "group-then-test" });
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", res.plan.transform_code);
    const out = fn({ [book.sheets[0].name]: book.sheets[0].rows });
    expect(out[0]["Matched"]).toBe(3);
    expect(out[0]["Out of"]).toBe(5);
  });
});
