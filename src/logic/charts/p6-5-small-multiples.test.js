import { describe, it, expect } from "vitest";
import { buildCrosstabDataset, buildSmallMultiplesData, SMALL_MULTIPLES_PANEL_CAP } from "./aggregate.js";
import { recommendChart } from "./advisor.js";
import { excelChartSteps } from "./excelChart.js";
import { deriveSheet } from "../workbook.js";

// P6-5 (fix-2026-07-11-steps-2-3-9-plain-english.md): small multiples as the
// honesty escape hatch. When a crosstab has too many categories for one
// readable grouped/stacked chart (> 12 labels AND enough subgroups that the
// 8-color cap folded some into "Other"), the advisor recommends a grid of
// mini charts — one panel per category, one shared scale — instead of
// refusing or cramming. Panels cap at 12; the full table carries the rest.

const pad = (n) => String(n).padStart(2, "0");

// Deterministic fixture: every category total and every subgroup total is
// distinct, so the largest-first sorts (and therefore which subgroups fold
// into "Other" and which categories hide past the panel cap) never depend on
// tie-breaking.
function bigRows({ cats = 14, drugs = 10 } = {}) {
  const rows = [];
  for (let c = 1; c <= cats; c++) {
    for (let d = 1; d <= drugs; d++) {
      rows.push({ Diagnosis: `cat-${pad(c)}`, Drug: `drug-${pad(d)}` });
    }
    for (let k = 0; k < cats - c; k++) rows.push({ Diagnosis: `cat-${pad(c)}`, Drug: "drug-01" });
  }
  for (let d = 2; d <= drugs; d++) {
    for (let k = 0; k < drugs - d; k++) rows.push({ Diagnosis: "cat-01", Drug: `drug-${pad(d)}` });
  }
  return rows;
}

function bigDataset(opts) {
  return buildCrosstabDataset(deriveSheet("E", bigRows(opts)), "Diagnosis", "Drug");
}

describe("P6-5 — advisor recommends small multiples for a crowded crosstab", () => {
  it("recommends smallMultiples when >12 categories AND subgroups folded into Other, with the 3 layouts as alternatives", () => {
    const d = bigDataset();
    expect(d.categories.length).toBe(14);
    expect(d.otherGrouped).toBe(3); // 10 raw drugs -> top 7 + Other(3)
    const rec = recommendChart(d);
    expect(rec.type).toBe("smallMultiples");
    expect(rec.reason).toMatch(/small multiple|mini chart|panel/i);
    expect(rec.alternatives.map((a) => a.layout).sort()).toEqual(["grouped", "stacked", "stacked100"]);
    expect(rec.alternatives.every((a) => a.type === "bar")).toBe(true);
    expect(rec.otherGroupedNote).toBeTruthy();
  });

  it("honors an explicit layout ask, but offers smallMultiples as an escape-hatch alternative", () => {
    const rec = recommendChart(bigDataset(), { requestedLayout: "stacked" });
    expect(rec.type).toBe("bar");
    expect(rec.layout).toBe("stacked");
    const altTypes = rec.alternatives.map((a) => a.type);
    expect(altTypes).toContain("smallMultiples");
    expect(rec.alternatives.filter((a) => a.type === "bar").map((a) => a.layout).sort()).toEqual(["grouped", "stacked100"]);
  });

  it("a small crosstab is unchanged — no smallMultiples anywhere (P6-1 behavior intact)", () => {
    const d = buildCrosstabDataset(deriveSheet("E", bigRows({ cats: 3, drugs: 4 })), "Diagnosis", "Drug");
    const rec = recommendChart(d);
    expect(rec.type).toBe("bar");
    expect(rec.layout).toBe("grouped");
    expect(rec.alternatives.map((a) => a.layout).sort()).toEqual(["stacked", "stacked100"]);
    expect(rec.alternatives.some((a) => a.type === "smallMultiples")).toBe(false);
  });

  it("many categories but few subgroups (nothing folded) stays a plain grouped bar", () => {
    const d = bigDataset({ cats: 14, drugs: 3 });
    expect(d.otherGrouped).toBeUndefined();
    const rec = recommendChart(d);
    expect(rec.type).toBe("bar");
    expect(rec.alternatives.some((a) => a.type === "smallMultiples")).toBe(false);
  });

  it("many subgroups but few categories stays a plain grouped bar", () => {
    const d = bigDataset({ cats: 5, drugs: 10 });
    expect(d.otherGrouped).toBe(3);
    const rec = recommendChart(d);
    expect(rec.type).toBe("bar");
    expect(rec.alternatives.some((a) => a.type === "smallMultiples")).toBe(false);
  });
});

describe("P6-5 — buildSmallMultiplesData", () => {
  it("caps panels at 12, counts the hidden rest, and passes subgroups through", () => {
    const d = bigDataset();
    const sm = buildSmallMultiplesData(d);
    expect(SMALL_MULTIPLES_PANEL_CAP).toBe(12);
    expect(sm.panels.length).toBe(12);
    expect(sm.hiddenCount).toBe(2);
    expect(sm.subgroups).toEqual(d.subgroups);
    expect(sm.panels[0].label).toBe("cat-01");
    // Largest single cell in the fixture is cat-01 x drug-01 = 14 rows.
    expect(sm.maxValue).toBe(14);
  });

  it("shares one scale across only the SHOWN panels — a hidden category's values don't stretch it", () => {
    const categories = [...Array(13)].map((_, i) => ({ label: `c${i + 1}`, total: 100 - i, values: [5, 3] }));
    categories[12] = { label: "c13", total: 1, values: [999, 0] };
    const sm = buildSmallMultiplesData({ kind: "crosstab", labelName: "L", subgroupName: "S", subgroups: ["a", "b"], categories });
    expect(sm.panels.length).toBe(12);
    expect(sm.hiddenCount).toBe(1);
    expect(sm.maxValue).toBe(5);
  });

  it("a crosstab at or under the cap shows every panel and hides none", () => {
    const d = bigDataset({ cats: 12, drugs: 10 });
    const sm = buildSmallMultiplesData(d);
    expect(sm.panels.length).toBe(12);
    expect(sm.hiddenCount).toBe(0);
  });
});

describe("P6-5 — Excel steps are honest about the missing native chart type", () => {
  it("gives the helper table plus the two real routes (per-category charts, or a PivotChart with a slicer)", () => {
    const d = bigDataset();
    const steps = excelChartSteps("smallMultiples", d, recommendChart(d));
    const titles = steps.map((s) => s.title);
    expect(titles).toContain("Build the helper table");
    const all = steps.map((s) => s.instruction).join(" ");
    expect(all).toMatch(/no built-in/i);
    expect(all).toMatch(/PivotChart/i);
    expect(all).toMatch(/slicer/i);
    expect(titles).toContain("Remember the folded groups");
  });

  it("a crosstab drawn as bars still gets the P6-1 steps (regression)", () => {
    const d = bigDataset();
    const steps = excelChartSteps("bar", d, { layout: "grouped" });
    const all = steps.map((s) => s.instruction).join(" ");
    expect(all).toMatch(/Clustered Column/);
    expect(all).not.toMatch(/PivotChart/i);
  });
});
