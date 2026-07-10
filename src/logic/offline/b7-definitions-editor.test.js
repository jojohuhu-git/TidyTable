import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { runOffline } from "./runOffline.js";
import { buildDefinitionEntry } from "./definitions.js";
import {
  emptyDefinitionsStore, addDefinitionEntry, removeDefinitionEntry,
  mergeDefinitions, serializeDefinitionsStore, parseDefinitionsStoreFile,
} from "./definitionsStore.js";

// B7: an in-app alternative to the Excel round-trip for a needs_definitions
// block — the user types a meaning right there, and it's used the same way a
// real Definitions sheet row would be, without ever needing to leave the app.

function encounters() {
  return deriveSheet("Encounters", [
    { Diagnosis: "pyelonephritis", Drug: "cephalexin", Duration_days: 10, PatientID: "P1" },
    { Diagnosis: "pyelonephritis", Drug: "amoxicillin", Duration_days: 5, PatientID: "P2" },
    { Diagnosis: "pyelonephritis", Drug: "ciprofloxacin", Duration_days: 12, PatientID: "P3" },
    { Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, PatientID: "P4" },
  ]);
}

describe("B7 — a question blocked on an undefined term is unblocked by an in-app definition", () => {
  it("blocks with needs_definitions and no Definitions sheet when the term is genuinely undefined", () => {
    const workbook = { fileName: "m.xlsx", sheets: [encounters()] };
    const res = runOffline("how many had oral beta-lactam", workbook, {});
    expect(res.kind).toBe("block");
    expect(res.missingTerms.map((m) => m.term)).toContain("oral beta lactam");
    expect(res.definitionsPresent).toBe(false);
  });

  it("answers confidently once the term is added to the in-app store, no Definitions sheet needed", () => {
    const workbook = { fileName: "m.xlsx", sheets: [encounters()] };
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("oral beta-lactam", "Drug", "cephalexin, amoxicillin"));

    const res = runOffline("how many had oral beta-lactam", workbook, { definitionsStore: store });
    expect(res.kind).toBe("answer");
    expect(res.resultRows[0]["Matched"]).toBe(3); // cephalexin (P1, P4), amoxicillin (P2)
  });

  it("a threshold-style typed definition works the same as a Definitions-sheet rule", () => {
    const workbook = { fileName: "m.xlsx", sheets: [encounters()] };
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("excess duration", "Duration_days", "> 7 when Diagnosis = pyelonephritis"));

    const res = runOffline("how many had excess duration", workbook, { definitionsStore: store });
    expect(res.kind).toBe("answer");
    expect(res.resultRows[0]["Matched"]).toBe(2); // P1 (10), P3 (12) — P4 doesn't have pyelonephritis
  });

  it("re-adding the same term (by its loose key) replaces the old entry instead of stacking a duplicate", () => {
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("excess durations", "Duration_days", "> 7"));
    store = addDefinitionEntry(store, buildDefinitionEntry("excess duration", "Duration_days", "> 5"));
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].value).toBe(5);
  });

  it("removeDefinitionEntry drops a term by its loose key", () => {
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("oral beta-lactam", "Drug", "cephalexin"));
    store = removeDefinitionEntry(store, "oral beta lactams");
    expect(store.entries).toHaveLength(0);
  });

  it("an in-app definition wins over a stale Definitions-sheet row for the same term", () => {
    const defsSheet = deriveSheet("Definitions", [
      { term: "oral beta-lactam", "column it applies to": "Drug", "values that count": "cephalexin" },
    ]);
    const workbook = { fileName: "m.xlsx", sheets: [encounters(), defsSheet] };
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("oral beta-lactam", "Drug", "cephalexin, amoxicillin"));

    const res = runOffline("how many had oral beta-lactam", workbook, { definitionsStore: store });
    expect(res.kind).toBe("answer");
    expect(res.resultRows[0]["Matched"]).toBe(3); // the store's wider list (P1, P2, P4), not the sheet's narrower one (P1, P4)
  });

  it("mergeDefinitions reports present=true from the store alone, with no sheet", () => {
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("x", "Drug", "cephalexin"));
    const merged = mergeDefinitions({ present: false, byTerm: new Map() }, store);
    expect(merged.present).toBe(true);
  });

  it("round-trips a store through export/import JSON", () => {
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("oral beta-lactam", "Drug", "cephalexin, amoxicillin"));
    const text = serializeDefinitionsStore(store);
    const parsed = parseDefinitionsStoreFile(text);
    expect(parsed.entries).toEqual(store.entries);
  });

  it("rejects an import file that isn't a definitions export", () => {
    expect(() => parseDefinitionsStoreFile("not json")).toThrow();
    expect(() => parseDefinitionsStoreFile('{"foo": 1}')).toThrow();
  });
});
