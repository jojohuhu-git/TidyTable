import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { matchRequest } from "./matcher.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";
import { foldWord } from "./wordforms.js";
import { conceptColumnCandidates, valueContentCandidates, isConceptWord } from "./concepts.js";
import {
  emptyAliasStore, fileSignature, rememberColumnAlias, columnAliasesFor, forgetColumnAlias, aliasKey,
} from "./aliasStore.js";
import { deriveSheet } from "../workbook.js";

// Phase 3 — everyday-word matching (plan-2026-07-10-offline-smarts.md).
// The matcher knows column NAMES; people type the words around them. These
// tests cover each layer AND the honesty guardrail: a stretch is always a
// confirm-chip, never a silent answer, and pure nonsense still declines.

const wb = () => buildExampleWorkbook();
// Example columns: PatientID, Diagnosis, Drug, Duration_days, Visit_date, Lab_value.

describe("Layer 1 — word-form folding", () => {
  it("folds verb/noun forms to one canonical token", () => {
    expect(foldWord("treated")).toBe(foldWord("treatment"));
    expect(foldWord("prescribed")).toBe(foldWord("prescription"));
    expect(foldWord("diagnoses")).toBe(foldWord("diagnosis"));
  });
  it("keeps genuinely different words apart (no over-stemming)", () => {
    // A prescriber (a person / column) is not a prescription (a drug record).
    expect(foldWord("prescriber")).not.toBe(foldWord("prescription"));
  });
  it("leaves short tokens untouched so a stray letter can't fold into meaning", () => {
    expect(foldWord("s")).toBe("s");
    expect(foldWord("e")).toBe("e");
  });
});

describe("Layer 2 — concept seed groups resolve everyday words to columns", () => {
  const headers = wb().sheets[0].headers;
  it('"treatment length" points to the Duration_days column', () => {
    const cands = conceptColumnCandidates("treatment length", headers);
    expect(cands[0].column).toBe("Duration_days");
  });
  it('"condition" points to the Diagnosis column', () => {
    expect(conceptColumnCandidates("condition", headers)[0].column).toBe("Diagnosis");
  });
  it('"antibiotic" points to the Drug column', () => {
    expect(conceptColumnCandidates("antibiotic", headers)[0].column).toBe("Drug");
  });
  it("a nonsense word maps to no concept", () => {
    expect(conceptColumnCandidates("blorptastic", headers)).toEqual([]);
    expect(isConceptWord("blorptastic")).toBe(false);
  });
});

describe("Everyday-word questions now ask (never silently answer)", () => {
  it('"how long were patients treated on average" offers a Duration_days chip', () => {
    const res = runOffline("how long were patients treated on average", wb());
    expect(res.kind).toBe("confirm-value");
    expect(res.candidates[0]).toMatchObject({ kind: "column", column: "Duration_days" });
  });

  it('"average treatment length" offers a Duration_days chip', () => {
    const res = runOffline("average treatment length", wb());
    expect(res.kind).toBe("confirm-value");
    expect(res.candidates[0].column).toBe("Duration_days");
  });

  it('"how many patients per condition" offers a Diagnosis group-by chip', () => {
    const res = runOffline("how many patients per condition", wb(), { grainMode: "row" });
    expect(res.kind).toBe("confirm-value");
    expect(res.candidates[0]).toMatchObject({ kind: "column", column: "Diagnosis" });
  });

  it('"treated for more than 7 days" offers a Duration_days threshold chip, not a block', () => {
    const res = runOffline("how many patients were treated for more than 7 days", wb(), { grainMode: "row" });
    expect(res.kind).toBe("confirm-value");
    expect(res.candidates[0].column).toBe("Duration_days");
  });

  it("confirming the column then answers correctly (alias round-trip)", () => {
    // The user accepts "treatment length" -> Duration_days; next run is exact.
    const res = runOffline("average treatment length", wb(), {
      columnAliases: { "treatment length": "Duration_days" },
    });
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toBe('Averaging "Duration_days".');
  });

  it("a confirmed threshold column answers the count", () => {
    const aliasMap = new Map([["treated", { kind: "column", column: "Duration_days" }]]);
    const res = runOffline("how many patients were treated for more than 7 days", wb(), { grainMode: "row", aliasMap });
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toMatch(/"Duration_days" is over 7/);
  });
});

describe("Layer 4 — value-content hint (column named by what its values look like)", () => {
  it('"antibiotic" nominates a drug column even when the header is not called that', () => {
    // A column literally named "Med_A" holding antibiotic names.
    const sheet = deriveSheet("Rx", [
      { PatientID: "P1", Med_A: "amoxicillin" },
      { PatientID: "P2", Med_A: "cephalexin" },
      { PatientID: "P3", Med_A: "amoxicillin" },
    ]);
    const index = new Map();
    for (const h of sheet.headers) {
      const m = new Map();
      for (const r of sheet.rows) {
        const v = r[h.name];
        if (v != null && String(v).trim() !== "") m.set(String(v).toLowerCase(), v);
      }
      index.set(h.name, m);
    }
    const cands = valueContentCandidates("antibiotic", sheet.headers, index);
    expect(cands.some((c) => c.column === "Med_A")).toBe(true);
  });
});

describe("Layer 5 — filler verbs near a threshold don't block", () => {
  it('"treated" as residue next to an exact threshold is ignored, not blocked', () => {
    // Duration_days resolves exactly; "treated" is a filler verb, not residue.
    const res = runOffline("how many patients treated with duration_days over 7", wb(), { grainMode: "row" });
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toMatch(/over 7/);
  });
});

describe("Non-regression — nonsense still declines, never a confident guess", () => {
  it('"average blorptastic" declines (no numeric column)', () => {
    const res = runOffline("average blorptastic", wb());
    expect(res.kind).toBe("decline");
  });
  it('"how many wizzles" blocks for a definition, does not invent a column', () => {
    const res = runOffline("how many wizzles", wb());
    expect(res.kind).not.toBe("answer");
  });
  it("a compound with a stray non-concept word is not hijacked by concepts", () => {
    // "uti duration over 7" must still split UTI (value) + Duration threshold,
    // not concept-resolve "uti duration" as one column.
    const m = matchRequest("how many patients with UTI had duration_days over 7", wb(), { present: false });
    expect(["confident", "grain"]).toContain(m.status);
  });
});

describe("Learned-alias store — persistence + privacy boundary", () => {
  it("files aliases per file shape and reads them back", () => {
    const headers = wb().sheets[0].headers;
    const sig = fileSignature(headers);
    let store = emptyAliasStore();
    store = rememberColumnAlias(store, sig, "treatment length", "Duration_days");
    expect(columnAliasesFor(store, sig)[aliasKey("treatment length")]).toBe("Duration_days");
  });

  it("a different file shape does not see another file's aliases", () => {
    const sigA = fileSignature(wb().sheets[0].headers);
    const sigB = fileSignature(deriveSheet("Other", [{ Foo: 1, Bar: 2 }]).headers);
    let store = emptyAliasStore();
    store = rememberColumnAlias(store, sigA, "treatment length", "Duration_days");
    expect(columnAliasesFor(store, sigB)).toEqual({});
  });

  it("stores ONLY column names — never a cell value (privacy boundary)", () => {
    const sig = fileSignature(wb().sheets[0].headers);
    let store = emptyAliasStore();
    store = rememberColumnAlias(store, sig, "the bug", "Diagnosis");
    // Serialize the whole store and assert no example cell value leaked in.
    const dump = JSON.stringify(store);
    for (const val of ["amoxicillin", "cephalexin", "UTI", "pneumonia", "cystitis", "P1", "Dr. Alavi"]) {
      expect(dump.includes(val)).toBe(false);
    }
    expect(dump).toContain("Diagnosis"); // the column name is fine to persist
  });

  it("forgetting an alias removes it without touching others", () => {
    const sig = "a|b";
    let store = emptyAliasStore();
    store = rememberColumnAlias(store, sig, "one", "A");
    store = rememberColumnAlias(store, sig, "two", "B");
    store = forgetColumnAlias(store, sig, "one");
    const aliases = columnAliasesFor(store, sig);
    expect(aliases[aliasKey("one")]).toBeUndefined();
    expect(aliases[aliasKey("two")]).toBe("B");
  });

  it("rememberColumnAlias does not mutate the input store", () => {
    const sig = "a|b";
    const store = emptyAliasStore();
    const next = rememberColumnAlias(store, sig, "one", "A");
    expect(store.files).toEqual({});
    expect(next).not.toBe(store);
  });
});
