import { describe, it, expect } from "vitest";
import { scoreTokenMatch, findColumnCandidates, tokens } from "./valueMatch.js";
import { matchRequest } from "./matcher.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";
import { resolveChartRequest } from "../charts/textToChart.js";

// P1-3 — wire foldWord into the token scorer so everyday plurals / verb-noun
// forms reach their column ("diagnoses" -> "Diagnosis", "drugs" -> "Drug").
// Fixes R6 ("diagnoses by number of patients" used to dead-end with "I couldn't
// tell which column to compare"). The never-guess promise is kept by scoring a
// fold-only match BELOW every literal tier, so every caller treats it as a
// stretch to CONFIRM, never a silent answer. Example columns: PatientID,
// Diagnosis, Drug, Duration_days, Visit_date, Lab_value.

const wb = () => buildExampleWorkbook();
const headers = () => wb().sheets[0].headers;

describe("P1-3 unit — scoreTokenMatch folds plurals as a low-scoring stretch", () => {
  it("a plural query now matches its singular column, but only as a fold stretch (0.5)", () => {
    // Pre-fix this was null: "diagnoses" is not a prefix of "diagnosis" (they
    // diverge at the ending), so the raw scorer never reached it.
    expect(scoreTokenMatch(tokens("diagnoses"), tokens("Diagnosis"))).toBe(0.5);
    expect(scoreTokenMatch(tokens("drugs"), tokens("Drug"))).toBe(0.5);
  });

  it("a fold match scores strictly below every literal tier (raw always wins)", () => {
    // Literal exact / all-equal / prefix scores are unchanged by the fix.
    expect(scoreTokenMatch(tokens("Diagnosis"), tokens("Diagnosis"))).toBe(3);
    expect(scoreTokenMatch(tokens("coli"), tokens("escherichia coli"))).toBe(2);
    expect(scoreTokenMatch(tokens("e"), tokens("escherichia"))).toBe(1);
    // 0.5 sits under the raw prefix tier (1) so a real prefix beats a fold.
    expect(scoreTokenMatch(tokens("diagnoses"), tokens("Diagnosis"))).toBeLessThan(1);
  });

  it("findColumnCandidates nominates the singular column for a plural phrase", () => {
    expect(findColumnCandidates("diagnoses", headers())[0]).toBe("Diagnosis");
    expect(findColumnCandidates("drugs", headers())[0]).toBe("Drug");
  });
});

describe("P1-3 honesty guardrails — folding never bridges unrelated words", () => {
  it('keeps the "prescriber vs prescription" families apart (fold+prefix refused)', () => {
    // "prescription" folds to "prescribe", which IS a prefix of "prescriber" —
    // but a fold that only survives as a PREFIX is refused, so a drug-record word
    // can never hijack a people column.
    expect(scoreTokenMatch(tokens("prescription"), tokens("prescriber"))).toBeNull();
    expect(scoreTokenMatch(tokens("prescriber"), tokens("prescription"))).toBeNull();
  });

  it('a plural does not hijack a longer compound column ("patients" -/> "PatientID")', () => {
    // "patients" folds to "patient", a prefix of "patientid" — refused for the
    // same reason. (Raw was null too; this locks the behavior in.)
    expect(scoreTokenMatch(tokens("patients"), tokens("PatientID"))).toBeNull();
  });

  it("pure nonsense still matches nothing", () => {
    expect(scoreTokenMatch(tokens("blorptastic"), tokens("Diagnosis"))).toBeNull();
  });
});

describe("P1-3 R6 — Step 9 one-brain path (resolveChartRequest -> matchRequest)", () => {
  it('"diagnoses by number of patients" resolves to a Diagnosis count, flagged to confirm', () => {
    const res = resolveChartRequest("diagnoses by number of patients", wb().sheets[0]);
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Diagnosis");
    expect(res.aggMode).toBe("count");
    // Reached only by folding, so it is a stretch the UI confirms — not silent.
    expect(res.confidence).toBe("stretched");
  });

  it('"drugs" resolves to the Drug column as a stretched chart, not "no column found"', () => {
    const res = resolveChartRequest("drugs by number of patients", wb().sheets[0]);
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Drug");
    expect(res.confidence).toBe("stretched");
  });
});

describe("P1-3 — fold also transfers to the Step 3 pipeline (matchRequest)", () => {
  it('a plural group-by "how many patients per diagnoses" asks a Diagnosis confirm chip', () => {
    const m = matchRequest("how many patients per diagnoses", wb(), { present: false }, {});
    expect(m.status).toBe("needs_confirm");
    expect(m.phrase).toBe("diagnoses");
    expect(m.candidates[0]).toMatchObject({ kind: "column", column: "Diagnosis" });
  });
});
