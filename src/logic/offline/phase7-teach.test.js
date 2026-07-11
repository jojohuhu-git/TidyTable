// @vitest-environment happy-dom
// Phase 7.9 (plan-2026-07-10-offline-smarts.md) — the teach-it form feeds the
// SAME stores Phase 3 uses. Here we prove the outcome: a request that declines
// resolves once the taught column alias / definition is supplied.

import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { foldKey } from "../checkup/normalizers.js";
import { emptyDefinitionsStore, addDefinitionEntry } from "./definitionsStore.js";
import { buildDefinitionEntry } from "./definitions.js";
import { deriveSheet } from "../workbook.js";

function book() {
  const enc = deriveSheet("Encounters", [
    { PatientID: "P1", Drug: "cephalexin", Duration_days: 10 },
    { PatientID: "P2", Drug: "amoxicillin", Duration_days: 7 },
    { PatientID: "P3", Drug: "cephalexin", Duration_days: 5 },
  ]);
  return { fileName: "m.xlsx", sheets: [enc] };
}

describe("Phase 7.9 — a taught column alias resolves a previously-declining request", () => {
  it("'average widget' declines, then answers once 'widget' → Duration_days is taught", () => {
    const before = runOffline("average widget", book(), {});
    expect(before.kind).toBe("decline");

    const after = runOffline("average widget", book(), {
      columnAliases: { [foldKey("widget")]: "Duration_days" },
    });
    expect(after.kind).toBe("answer");
    expect(after.match.aggregation.targetColumn).toBe("Duration_days");
  });
});

describe("Phase 7.9 — a taught value definition resolves a blocked value filter", () => {
  it("'how many records with betalactam' resolves once betalactam → Drug values is taught", () => {
    const store = addDefinitionEntry(
      emptyDefinitionsStore(),
      buildDefinitionEntry("betalactam", "Drug", "cephalexin, amoxicillin"),
    );
    const res = runOffline("how many records with betalactam", book(), { definitionsStore: store });
    expect(res.kind).toBe("answer");
    const last = res.exec.levels[res.exec.levels.length - 1];
    expect(last.count).toBe(3); // all three rows are one of the two drugs
  });
});
