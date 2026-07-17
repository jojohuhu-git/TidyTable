import { describe, it, expect } from "vitest";
import { rankFrequencyPooled, executePooledRank } from "./cohort.js";
import { deriveSheet } from "../workbook.js";

// P1-4 — pooled multi-column ranking. Several related picklist columns (e.g. a
// "Primary" and a "Secondary" diagnosis column drawn from the same vocabulary)
// get their values pooled into ONE tally and ranked. Counting policy (Decision
// D, owner-approved 2026-07-11): count every occurrence by default; "once per
// row" and "once per patient" are the alternatives. Blank cells are skipped.

// Synthetic fixture: two overlapping picklist columns, a repeat patient, and a
// same-row duplicate value — enough to separate all three counting policies.
const fixture = () => deriveSheet("Dx", [
  { PatientID: "P1", Primary: "UTI", Secondary: "sepsis" },
  { PatientID: "P1", Primary: "UTI", Secondary: "" },
  { PatientID: "P2", Primary: "pyelonephritis", Secondary: "UTI" },
  { PatientID: "P3", Primary: "sepsis", Secondary: "sepsis" },
  { PatientID: "P4", Primary: "", Secondary: "UTI" },
]);
const cols = ["Primary", "Secondary"];
const asMap = (r) => Object.fromEntries(r.entries.map((e) => [e.label, e.count]));

describe("P1-4 engine — rankFrequencyPooled counting policies", () => {
  it("occurrence policy counts every non-blank cell across the chosen columns", () => {
    const r = rankFrequencyPooled(fixture().rows, cols, "occurrence");
    expect(asMap(r)).toEqual({ UTI: 4, sepsis: 3, pyelonephritis: 1 });
    expect(r.mentions).toBe(8);
    expect(r.blankCells).toBe(2); // row2 Secondary "" + row5 Primary ""
    expect(r.total).toBe(5);
  });

  it("row policy counts a value once per row even if it appears in both columns", () => {
    const r = rankFrequencyPooled(fixture().rows, cols, "row");
    // Row 4 has sepsis in BOTH columns → counted once for that row.
    expect(asMap(r)).toEqual({ UTI: 4, sepsis: 2, pyelonephritis: 1 });
    expect(r.mentions).toBe(7);
  });

  it("patient policy counts a value once per patient across all their rows", () => {
    const r = rankFrequencyPooled(fixture().rows, cols, "patient", "PatientID");
    // P1's two rows both have UTI → UTI counts once for P1.
    expect(asMap(r)).toEqual({ UTI: 3, sepsis: 2, pyelonephritis: 1 });
    expect(r.mentions).toBe(6);
  });

  it("preserves first-seen order in entries (deterministic, before ranking)", () => {
    const r = rankFrequencyPooled(fixture().rows, cols, "occurrence");
    expect(r.entries.map((e) => e.label)).toEqual(["UTI", "sepsis", "pyelonephritis"]);
  });
});

describe("P1-4 engine — executePooledRank applies filter stages then ranks", () => {
  const wb = () => ({ sheets: [fixture()] });

  it("ranks pooled occurrences most-first with ties kept", () => {
    const match = {
      sheetName: "Dx", stages: [],
      pooled: { columns: cols, policy: "occurrence", n: null, direction: "most" },
    };
    const exec = executePooledRank(match, wb());
    expect(exec.ranked.map((e) => [e.label, e.count])).toEqual([["UTI", 4], ["sepsis", 3], ["pyelonephritis", 1]]);
    expect(exec.mentions).toBe(8);
    expect(exec.distinctValues).toBe(3);
  });

  it("honors a top-N cap", () => {
    const match = {
      sheetName: "Dx", stages: [],
      pooled: { columns: cols, policy: "occurrence", n: 1, direction: "most" },
    };
    const exec = executePooledRank(match, wb());
    expect(exec.ranked.map((e) => e.label)).toEqual(["UTI"]);
  });
});
