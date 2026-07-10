import { describe, it, expect } from "vitest";
import { buildExamplePrompts, OFFLINE_INTENTS } from "./examplePrompts.js";
import { matchRequest } from "./matcher.js";
import { deriveSheet } from "../workbook.js";

// W2f: every example prompt must be genuinely answerable offline (verified
// through the same matchRequest() the real run uses), built from the user's
// own uploaded headers/values — never a made-up placeholder.
// Duration_days repeats across rows (7, 10, 7, 10, 7, ...) so it reads as a
// genuine numeric measure rather than tripping the "mostly-distinct, looks
// like an ID" heuristic profileColumns uses to avoid group-by/threshold
// examples on an ID-like column — matches how a real duration column looks.
function dcAntibioticsWorkbook() {
  const enc = deriveSheet("Encounters", [
    { PatientID: "P1", "Urine Organisms": "ESCHERICHIA COLI", Ward: "ICU", Duration_days: 10 },
    { PatientID: "P2", "Urine Organisms": "KLEBSIELLA PNEUMONIAE", Ward: "General", Duration_days: 7 },
    { PatientID: "P3", "Urine Organisms": "ESCHERICHIA COLI", Ward: "General", Duration_days: 10 },
    { PatientID: "P4", "Urine Organisms": "ESCHERICHIA COLI", Ward: "ICU", Duration_days: 7 },
    { PatientID: "P5", "Urine Organisms": "ESCHERICHIA COLI", Ward: "General", Duration_days: 10 },
    { PatientID: "P6", "Urine Organisms": "KLEBSIELLA PNEUMONIAE", Ward: "ICU", Duration_days: 7 },
  ]);
  return { fileName: "DC antibiotics.xlsx", sheets: [enc] };
}

describe("buildExamplePrompts — verified, data-driven example questions", () => {
  it("returns [] when there is no workbook or no rows", () => {
    expect(buildExamplePrompts(null)).toEqual([]);
    expect(buildExamplePrompts({ sheets: [] })).toEqual([]);
    expect(buildExamplePrompts({ sheets: [deriveSheet("Empty", [])] })).toEqual([]);
  });

  it("every returned example resolves offline (confident or needs_confirm), never a decline", () => {
    const wb = dcAntibioticsWorkbook();
    const examples = buildExamplePrompts(wb);
    expect(examples.length).toBeGreaterThan(0);
    for (const ex of examples) {
      const match = matchRequest(ex.text, wb, { present: false });
      expect(["confident", "needs_confirm"]).toContain(match.status);
    }
  });

  it("returns at most `max` examples and never duplicates", () => {
    const wb = dcAntibioticsWorkbook();
    const examples = buildExamplePrompts(wb, 3);
    expect(examples.length).toBeLessThanOrEqual(3);
    const texts = examples.map((e) => e.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("uses real column/value names from the uploaded sheet, not placeholders", () => {
    const wb = dcAntibioticsWorkbook();
    const examples = buildExamplePrompts(wb);
    const joined = examples.map((e) => e.text).join(" | ");
    expect(joined).toMatch(/ESCHERICHIA COLI|Ward|Duration_days/);
  });

  it("includes a threshold-style example when a numeric column exists", () => {
    const wb = dcAntibioticsWorkbook();
    const examples = buildExamplePrompts(wb);
    expect(examples.some((e) => e.pattern === "threshold")).toBe(true);
  });

  it("includes a group-by example when a low-cardinality text column exists alongside a number column", () => {
    const wb = dcAntibioticsWorkbook();
    const examples = buildExamplePrompts(wb);
    expect(examples.some((e) => e.pattern.includes("group"))).toBe(true);
  });
});

describe("OFFLINE_INTENTS — the plain-words cheat-sheet", () => {
  it("lists the five supported intents with a plain description and example each", () => {
    expect(OFFLINE_INTENTS.length).toBeGreaterThanOrEqual(5);
    for (const i of OFFLINE_INTENTS) {
      expect(i.intent).toBeTruthy();
      expect(i.plain).toBeTruthy();
      expect(i.example).toBeTruthy();
    }
  });
});
