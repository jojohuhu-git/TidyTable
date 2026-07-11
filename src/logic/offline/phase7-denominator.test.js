// @vitest-environment happy-dom
// Phase 7.6 (plan-2026-07-10-offline-smarts.md) — denominator + missing
// transparency. An n (%) must state its denominator in words and note any rows
// blank in the filter column that sit in that denominator but can never match —
// the novice's most common silent stats error, caught by default.

import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { deriveSheet } from "../workbook.js";

// Drug is blank in 2 of 5 rows; Diagnosis is complete.
function book() {
  const enc = deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin" },
    { PatientID: "P2", Diagnosis: "UTI", Drug: "" },
    { PatientID: "P3", Diagnosis: "pneumonia", Drug: "amoxicillin" },
    { PatientID: "P4", Diagnosis: "UTI", Drug: "cephalexin" },
    { PatientID: "P5", Diagnosis: "pneumonia", Drug: null },
  ]);
  return { fileName: "m.xlsx", sheets: [enc] };
}

describe("Phase 7.6 — blank cells in a filter column are counted and stated", () => {
  const res = runOffline("how many rows with cephalexin", book(), {});

  it("execution records the blank-in-column count for the level", () => {
    const level = res.exec.levels[res.exec.levels.length - 1];
    expect(level.count).toBe(2);
    expect(level.denominator).toBe(5);
    expect(level.blankInColumn).toBe(2);
    expect(level.blankColumn).toBe("Drug");
  });

  it("the n (%) companion states the denominator and the blank count in words", () => {
    expect(res.plan.companion.answerText).toBe('2 (40%) of 5 rows; 2 of them blank in "Drug" (still in the denominator)');
  });

  it("the plain summary spells out that the blanks are in the denominator but can't match", () => {
    expect(res.plan.summary).toMatch(/2 of those 5 rows were blank in "Drug"/);
    expect(res.plan.summary).toMatch(/blanks are in the denominator but can never match/);
  });

  it("no blank note appears when the filter column (Diagnosis) has no blanks", () => {
    const res2 = runOffline("how many rows with UTI", book(), {});
    expect(res2.plan.companion.answerText).toBe("3 (60%) of 5 rows");
    expect(res2.exec.levels[0].blankInColumn).toBe(0);
  });
});
