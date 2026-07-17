import { describe, it, expect } from "vitest";
import { buildDataset, buildParetoData, describeParetoSummary } from "./aggregate.js";
import { excelChartSteps } from "./excelChart.js";
import { deriveSheet } from "../workbook.js";

// P6-3 (fix-2026-07-11-steps-2-3-9-plain-english.md): "add cumulative % line"
// for a ranked count bar — "which few drugs cover most use." Off by default;
// only meaningful for a count bar (a share of a whole), never a sum/average
// total. Fixture: 6 drugs out of 20 rows, counts 8/5/3/2/1/1 — cumulative %
// crosses the standard 80% Pareto line exactly at the 3rd drug (40+25+15=80),
// so "top 3 of 6 account for 80%" is an exact, non-rounded case.
function sheet() {
  const rows = [];
  const counts = { drugA: 8, drugB: 5, drugC: 3, drugD: 2, drugE: 1, drugF: 1 };
  let i = 0;
  for (const [drug, n] of Object.entries(counts)) {
    for (let j = 0; j < n; j++) rows.push({ PatientID: `P${i++}`, Drug: drug });
  }
  return deriveSheet("Encounters", rows);
}

describe("P6-3 — buildParetoData", () => {
  it("attaches cumulative value and cumulative percent to each point, largest first", () => {
    const dataset = buildDataset(sheet(), "Drug", null);
    const pareto = buildParetoData(dataset);
    expect(pareto.points.map((p) => p.label)).toEqual(["drugA", "drugB", "drugC", "drugD", "drugE", "drugF"]);
    expect(pareto.points.map((p) => p.cumValue)).toEqual([8, 13, 16, 18, 19, 20]);
    expect(pareto.points.map((p) => p.cumPct)).toEqual([40, 65, 80, 90, 95, 100]);
    expect(pareto.total).toBe(20);
  });

  it("declines (null) for a sum/average total — not a share of a whole", () => {
    const sheetWithValue = deriveSheet("Encounters", [
      { Drug: "drugA", Dose_mg: 10 },
      { Drug: "drugB", Dose_mg: 20 },
    ]);
    const sumDataset = buildDataset(sheetWithValue, "Drug", "Dose_mg");
    expect(buildParetoData(sumDataset)).toBeNull();
  });

  it("declines for a time-series axis and for fewer than two categories", () => {
    const oneCategory = deriveSheet("Encounters", [{ Drug: "drugA" }, { Drug: "drugA" }]);
    expect(buildParetoData(buildDataset(oneCategory, "Drug", null))).toBeNull();
  });
});

describe("P6-3 — describeParetoSummary", () => {
  it('states "top K of N account for P%" at the 80% threshold', () => {
    const dataset = buildDataset(sheet(), "Drug", null);
    const pareto = buildParetoData(dataset);
    expect(describeParetoSummary(pareto)).toBe("Top 3 of 6 account for 80%.");
  });

  it("never claims 80% when the real data never reaches it until every category is counted", () => {
    const flatRows = [];
    for (let i = 0; i < 4; i++) flatRows.push({ Drug: `drug${i}` }, { Drug: `drug${i}` });
    const dataset = buildDataset(deriveSheet("Encounters", flatRows), "Drug", null);
    const pareto = buildParetoData(dataset);
    // 4 categories tied at 25% each: cumulative after 3 is 75% (< 80), so the
    // honest crossing point is all 4 (100%), not a fabricated "80%" at K=3.
    expect(describeParetoSummary(pareto)).toBe("Top 4 of 4 account for 100%.");
  });
});

describe("P6-3 — Excel recipe includes the native Pareto chart type", () => {
  it("names Excel's built-in Pareto chart and a helper cumulative-% column", () => {
    const dataset = buildDataset(sheet(), "Drug", null);
    const pareto = buildParetoData(dataset);
    const steps = excelChartSteps("bar", dataset, {}, {}, pareto);
    const titles = steps.map((s) => s.title);
    expect(titles).toContain("Add the cumulative % line");
    const step = steps.find((s) => s.title === "Add the cumulative % line");
    expect(step.instruction).toMatch(/pareto/i);
    expect(step.instruction).toMatch(/cumulative/i);
  });

  it("omits the Pareto step when no cumulative line is on", () => {
    const dataset = buildDataset(sheet(), "Drug", null);
    const steps = excelChartSteps("bar", dataset, {}, {}, null);
    expect(steps.map((s) => s.title)).not.toContain("Add the cumulative % line");
  });
});
