// @vitest-environment happy-dom
// Phase 7.7 (plan-2026-07-10-offline-smarts.md) — grain memory. A remembered
// per-patient/per-row choice is applied instead of re-asking, and the store
// holds only column names + the mode (never a cell value).

import { describe, it, expect } from "vitest";
import {
  emptyGrainStore, rememberGrainChoice, grainChoiceFor, grainChoicesFor, forgetGrainChoice,
} from "./grainStore.js";
import { matchRequest } from "./matcher.js";
import { deriveSheet } from "../workbook.js";

// P1 repeats, so a per-patient count over repeating rows triggers the grain ask.
function book() {
  const enc = deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI" },
    { PatientID: "P1", Diagnosis: "UTI" },
    { PatientID: "P2", Diagnosis: "pneumonia" },
    { PatientID: "P3", Diagnosis: "UTI" },
  ]);
  return { fileName: "m.xlsx", sheets: [enc] };
}

describe("Phase 7.7 — grainStore", () => {
  it("remembers, reads, and forgets a choice per signature + entity column", () => {
    let store = emptyGrainStore();
    store = rememberGrainChoice(store, "sig1", "PatientID", "group-then-test");
    expect(grainChoiceFor(store, "sig1", "PatientID")).toBe("group-then-test");
    expect(grainChoicesFor(store, "sig1")).toEqual({ PatientID: "group-then-test" });
    store = forgetGrainChoice(store, "sig1", "PatientID");
    expect(grainChoiceFor(store, "sig1", "PatientID")).toBeNull();
  });

  it("ignores an invalid mode (only 'row'/'group-then-test' are stored)", () => {
    const store = rememberGrainChoice(emptyGrainStore(), "sig1", "PatientID", "bogus");
    expect(grainChoicesFor(store, "sig1")).toEqual({});
  });
});

describe("Phase 7.7 — the matcher applies a remembered grain instead of asking", () => {
  it("asks (status grain) with no memory", () => {
    const m = matchRequest("how many patients with UTI", book(), { present: false });
    expect(m.status).toBe("grain");
  });

  it("answers with the remembered mode and flags grainFromMemory", () => {
    const m = matchRequest("how many patients with UTI", book(), { present: false }, {
      grainChoices: { PatientID: "group-then-test" },
    });
    expect(m.status).toBe("confident");
    expect(m.grainMode).toBe("group-then-test");
    expect(m.grainFromMemory).toBe(true);
    expect(m.grainEntity).toBe("PatientID");
  });

  it("an explicit grainMode still wins and is NOT flagged as from memory", () => {
    const m = matchRequest("how many patients with UTI", book(), { present: false }, {
      grainMode: "row", grainChoices: { PatientID: "group-then-test" },
    });
    expect(m.status).toBe("confident");
    expect(m.grainMode).toBe("row");
    expect(m.grainFromMemory).toBe(false);
  });
});
