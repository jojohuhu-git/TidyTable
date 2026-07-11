import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildDataset } from "./aggregate.js";
import { recommendChart } from "./advisor.js";

// Phase 8.2 — chart-type inference is said out loud, naming the column the
// decision was made from, and always offers a one-click alternate.

function sheet(rows) { return deriveSheet("D", rows); }

describe("Phase 8.2 — the recommendation names the column it reasoned about", () => {
  it("bar: names the categorical label column", () => {
    const ds = buildDataset(sheet([{ Diagnosis: "UTI" }, { Diagnosis: "UTI" }, { Diagnosis: "pneumonia" }]), "Diagnosis", null);
    const rec = recommendChart(ds);
    expect(rec.type).toBe("bar");
    expect(rec.reason).toMatch(/Bar chart because "Diagnosis" is categories/);
  });

  it("line: names the time-like column", () => {
    const ds = buildDataset(sheet([{ Month: "2024-01", N: 1 }, { Month: "2024-02", N: 2 }]), "Month", "N");
    const rec = recommendChart(ds);
    expect(rec.type).toBe("line");
    expect(rec.reason).toMatch(/Line chart because "Month"/);
    // A one-click alternate is always offered, mirroring the honesty stance.
    expect(rec.alternatives.some((a) => a.type === "bar")).toBe(true);
  });

  it("scatter: names both number columns", () => {
    const ds = buildDataset(sheet([{ Age: 60, LOS: 4 }, { Age: 70, LOS: 6 }]), "Age", "LOS");
    const rec = recommendChart(ds);
    expect(rec.type).toBe("scatter");
    expect(rec.reason).toMatch(/"Age"/);
    expect(rec.reason).toMatch(/"LOS"/);
  });
});
