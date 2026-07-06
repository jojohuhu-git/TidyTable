// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { deriveSheet } from "../workbook.js";
import { runOffline } from "./runOffline.js";
import { matchRequest } from "./matcher.js";
import { parseDefinitions } from "./definitions.js";
import { detectIntent, detectComparator, splitNestedLevels } from "./synonyms.js";
import { listMisses, clearMisses } from "./missLog.js";

// --- fixtures ---------------------------------------------------------------

const DEFS = () =>
  deriveSheet("Definitions", [
    { term: "oral beta-lactam", "column it applies to": "Drug", "values that count": "cephalexin, amoxicillin, amox-clavulanate, cefpodoxime" },
    { term: "excess duration", "column it applies to": "Duration_days", "values that count": "> 7 when Diagnosis = pyelonephritis" },
  ]);

// One row per patient (no grain issue).
function bookUniquePatients(withDefs = true) {
  const enc = deriveSheet("Encounters", [
    { Diagnosis: "pyelonephritis", Drug: "cephalexin", Duration_days: 10, PatientID: "P1" },
    { Diagnosis: "pyelonephritis", Drug: "amoxicillin", Duration_days: 5, PatientID: "P2" },
    { Diagnosis: "pyelonephritis", Drug: "ciprofloxacin", Duration_days: 12, PatientID: "P3" },
    { Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, PatientID: "P4" },
    { Diagnosis: "pyelonephritis", Drug: "cefpodoxime", Duration_days: 9, PatientID: "P5" },
  ]);
  return { fileName: "m.xlsx", sheets: withDefs ? [enc, DEFS()] : [enc] };
}

// Patients repeat across rows (grain issue).
function bookRepeatingPatients() {
  const enc = deriveSheet("Encounters", [
    { Diagnosis: "pyelonephritis", Drug: "cephalexin", Duration_days: 10, PatientID: "P1" },
    { Diagnosis: "pyelonephritis", Drug: "amoxicillin", Duration_days: 4, PatientID: "P1" },
    { Diagnosis: "pyelonephritis", Drug: "cefpodoxime", Duration_days: 9, PatientID: "P2" },
    { Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, PatientID: "P3" },
    { Diagnosis: "pyelonephritis", Drug: "ciprofloxacin", Duration_days: 12, PatientID: "P4" },
  ]);
  return { fileName: "m.xlsx", sheets: [enc, DEFS()] };
}

const NESTED_Q =
  "Of patients with pyelonephritis, how many received an oral beta lactam, and of those, how many had excess durations";

beforeEach(() => clearMisses());

// --- small units ------------------------------------------------------------

describe("synonyms", () => {
  it("detects intent by the most specific phrase", () => {
    expect(detectIntent("how many patients").intent).toBe("count");
    expect(detectIntent("what proportion of rows").intent).toBe("proportion");
    expect(detectIntent("the total dose").intent).toBe("sum");
  });
  it("reads comparators with word boundaries", () => {
    expect(detectComparator("duration over 7").op).toBe(">");
    expect(detectComparator("at least 5 days").op).toBe(">=");
    expect(detectComparator("no comparator here")).toBe(null);
  });
  it("splits nested levels on 'of those'", () => {
    expect(splitNestedLevels("A, and of those, B")).toEqual(["A", "B"]);
  });
});

describe("definitions sheet parsing", () => {
  it("reads value lists and threshold rules with a when-guard", () => {
    const defs = parseDefinitions(bookUniquePatients());
    expect(defs.present).toBe(true);
    const beta = defs.byTerm.get("oralbetalactam");
    expect(beta.kind).toBe("values");
    expect(beta.values).toContain("cephalexin");
    const excess = defs.byTerm.get("excessduration");
    expect(excess.kind).toBe("threshold");
    expect(excess.op).toBe(">");
    expect(excess.value).toBe(7);
    expect(excess.when).toEqual({ column: "Diagnosis", value: "pyelonephritis" });
  });
  it("reports absent when there is no Definitions sheet", () => {
    expect(parseDefinitions(bookUniquePatients(false)).present).toBe(false);
  });
});

// --- scenario 3 -------------------------------------------------------------

describe("scenario 3: nested cohort question", () => {
  it("blocks and asks for definitions when the sheet is missing", () => {
    const res = runOffline(NESTED_Q, bookUniquePatients(false));
    expect(res.kind).toBe("block");
    expect(res.definitionsPresent).toBe(false);
    const terms = res.missingTerms.map((m) => m.term).join(" ");
    expect(terms).toMatch(/beta lactam/i);
    expect(terms).toMatch(/excess/i);
    expect(res.message).toMatch(/Definitions sheet/i);
  });

  it("with definitions filled, gives correct nested counts and proportions, no key needed", () => {
    const res = runOffline(NESTED_Q, bookUniquePatients(true));
    expect(res.kind).toBe("answer");
    const counts = res.exec.levels.map((l) => l.count);
    expect(counts).toEqual([4, 3, 2]); // pyelo, then oral beta-lactam, then excess duration
    const denoms = res.exec.levels.map((l) => l.denominator);
    expect(denoms).toEqual([5, 4, 3]);
    // The trust line spells out exactly what was counted.
    expect(res.lookedFor).toMatch(/Diagnosis/);
    expect(res.lookedFor).toMatch(/Drug/);
    expect(res.plan.engine).toBe("offline");
  });

  it("the plan's transform reproduces the same counts (worker-honest)", () => {
    const res = runOffline(NESTED_Q, bookUniquePatients(true));
    const sheets = { Encounters: bookUniquePatients(true).sheets[0].rows };
    // eslint-disable-next-line no-new-func
    const rows = new Function("sheets", res.plan.transform_code)(sheets);
    expect(rows.map((r) => r.Matched)).toEqual([4, 3, 2]);
  });
});

// --- scenario 4: grain ------------------------------------------------------

describe("scenario 4: grain detection over repeating rows", () => {
  it("asks to combine rows before answering a per-patient question", () => {
    const res = runOffline(NESTED_Q, bookRepeatingPatients());
    expect(res.kind).toBe("clarify-grain");
    expect(res.grain.entityColumn).toBe("PatientID");
    expect(res.grain.question).toMatch(/combine/i);
  });

  it("group-then-test gives the per-patient answer", () => {
    const res = runOffline(NESTED_Q, bookRepeatingPatients(), { grainMode: "group-then-test" });
    expect(res.kind).toBe("answer");
    expect(res.exec.mode).toBe("group-then-test");
    expect(res.exec.unit).toBe("patients");
    expect(res.exec.levels.map((l) => l.count)).toEqual([3, 2, 2]);
    expect(res.exec.total).toBe(4); // four distinct patients
  });
});

// --- scenario 7: graceful decline ------------------------------------------

describe("scenario 7: no confident wrong answer", () => {
  it("declines gibberish and logs the miss", () => {
    const res = runOffline("asdf qwerty zxcv lorem", bookUniquePatients());
    expect(res.kind).toBe("decline");
    expect(res.claudeHint).toBeTruthy();
    expect(listMisses().map((m) => m.request)).toContain("asdf qwerty zxcv lorem");
  });

  it("declines an AI-territory request rather than guessing", () => {
    const res = runOffline("write a short paragraph summarizing these antibiotics", bookUniquePatients());
    expect(res.kind).toBe("decline");
    expect(res.kind).not.toBe("answer");
  });
});
