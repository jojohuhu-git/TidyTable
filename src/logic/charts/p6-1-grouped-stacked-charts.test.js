import { describe, it, expect } from "vitest";
import { resolveChartRequest } from "./textToChart.js";
import { buildCrosstabDataset } from "./aggregate.js";
import { recommendChart } from "./advisor.js";
import { deriveSheet } from "../workbook.js";

// P6-1 (fix-2026-07-11-steps-2-3-9-plain-english.md): grouped/stacked/100%
// stacked bars for two categorical columns. Flips the P3-2 interim decline
// (fix-2026-07-11-p3-2-two-column-decline.test.js) into real support.

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, Ward: "ICU" },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "azithromycin", Duration_days: 7, Ward: "General" },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 5, Ward: "ICU" },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, Ward: "General" },
    { PatientID: "P5", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 6, Ward: "ICU" },
    { PatientID: "P6", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 8, Ward: "General" },
    { PatientID: "P7", Diagnosis: "cystitis", Drug: "nitrofurantoin", Duration_days: 5, Ward: "ICU" },
    { PatientID: "P8", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 4, Ward: "General" },
    { PatientID: "P9", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, Ward: "ICU" },
    { PatientID: "P10", Diagnosis: "pneumonia", Drug: "azithromycin", Duration_days: 9, Ward: "General" },
    { PatientID: "P11", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 7, Ward: "ICU" },
    { PatientID: "P12", Diagnosis: "cystitis", Drug: "nitrofurantoin", Duration_days: 4, Ward: "General" },
  ]);
}

describe("P6-1 — free-text resolution of two-column requests (R7 flip)", () => {
  it('"drug mix by diagnosis" resolves to a 100% stacked crosstab ("mix" = share)', () => {
    const res = resolveChartRequest("drug mix by diagnosis", sheet());
    expect(res.status).toBe("resolved");
    expect(res.kind).toBe("crosstab");
    expect(res.labelCol).toBe("Diagnosis");
    expect(res.subgroupCol).toBe("Drug");
    expect(res.layout).toBe("stacked100");
    expect(res.confidence).toBe("exact");
  });

  it('"breakdown of Drug within each Diagnosis" resolves to 100% stacked ("breakdown" = share)', () => {
    const res = resolveChartRequest("breakdown of Drug within each Diagnosis", sheet());
    expect(res.status).toBe("resolved");
    expect(res.kind).toBe("crosstab");
    expect(res.labelCol).toBe("Diagnosis");
    expect(res.subgroupCol).toBe("Drug");
    expect(res.layout).toBe("stacked100");
  });

  it('"Drug by Diagnosis stacked" resolves to plain stacked (composition, not %)', () => {
    const res = resolveChartRequest("Drug by Diagnosis stacked", sheet());
    expect(res.status).toBe("resolved");
    expect(res.kind).toBe("crosstab");
    expect(res.layout).toBe("stacked");
  });

  it('R7: "compare drug use between diagnoses" resolves to grouped bars (comparison), not a decline', () => {
    const res = resolveChartRequest("compare drug use between diagnoses", sheet());
    expect(res.status).toBe("resolved");
    expect(res.kind).toBe("crosstab");
    expect(res.labelCol).toBe("Diagnosis");
    expect(res.subgroupCol).toBe("Drug");
    expect(res.layout).toBe("grouped");
  });

  it('a bare "X by Y" with no layout word defaults to grouped', () => {
    const res = resolveChartRequest("drug by diagnosis", sheet());
    expect(res.layout).toBe("grouped");
  });

  it("a genuine three-variable request (value column already claimed, plus a second real category) still declines, naming every column", () => {
    const res = resolveChartRequest("average duration by diagnosis per ward", sheet());
    expect(res.status).toBe("none");
    expect(res.reason).toBe("two-column");
    expect(res.message).toMatch(/more than one thing/i);
    expect(res.message).toMatch(/Ward/);
    expect(res.message).toMatch(/Diagnosis/);
    expect(res.message).toMatch(/Duration_days/);
  });
});

describe("P6-1 — buildCrosstabDataset", () => {
  it("counts rows into a label x subgroup grid, sorted largest-total-first", () => {
    const d = buildCrosstabDataset(sheet(), "Diagnosis", "Drug");
    expect(d.kind).toBe("crosstab");
    expect(d.labelName).toBe("Diagnosis");
    expect(d.subgroupName).toBe("Drug");
    // UTI: cephalexin x3, amoxicillin x2 = 5 total (largest, first)
    expect(d.categories[0].label).toBe("UTI");
    expect(d.categories[0].total).toBe(5);
    const cephIdx = d.subgroups.indexOf("cephalexin");
    const amoxIdx = d.subgroups.indexOf("amoxicillin");
    expect(d.categories[0].values[cephIdx]).toBe(3);
    expect(d.categories[0].values[amoxIdx]).toBe(2);
    // cystitis: cephalexin x2, nitrofurantoin x2 = 4
    const cystitis = d.categories.find((c) => c.label === "cystitis");
    expect(cystitis.total).toBe(4);
  });

  it("caps subgroups at the Okabe-Ito 8, folding the smallest into one Other bucket", () => {
    const rows = [];
    // 10 distinct drugs across 2 diagnoses; drug-9 and drug-10 are the smallest.
    for (let i = 1; i <= 8; i++) {
      rows.push({ Diagnosis: "UTI", Drug: `drug-${i}`, Ward: "ICU" });
      rows.push({ Diagnosis: "UTI", Drug: `drug-${i}`, Ward: "ICU" });
    }
    rows.push({ Diagnosis: "UTI", Drug: "drug-9", Ward: "ICU" });
    rows.push({ Diagnosis: "UTI", Drug: "drug-10", Ward: "ICU" });
    const d = buildCrosstabDataset(deriveSheet("E", rows), "Diagnosis", "Drug");
    expect(d.subgroups.length).toBe(8); // top 7 + Other
    expect(d.subgroups[7]).toMatch(/^Other \(3 smaller groups\)$/);
    expect(d.otherGrouped).toBe(3);
    const otherIdx = 7;
    expect(d.categories[0].values[otherIdx]).toBe(4); // drug-8 (2 rows) + drug-9 + drug-10 (1 row each)
  });

  it("respects a single-value filter, same as the existing categorical dataset", () => {
    const d = buildCrosstabDataset(sheet(), "Diagnosis", "Drug", { filter: { column: "Ward", value: "ICU" } });
    expect(d.filter).toEqual({ column: "Ward", value: "ICU" });
    // ICU rows only: P1,P3,P5,P7,P9,P11 -> UTI ceph x2 (P1,P5,P11=3 actually all ICU) let's just check total sums to ICU row count
    const total = d.categories.reduce((s, c) => s + c.total, 0);
    expect(total).toBe(6); // 6 ICU rows in the fixture
  });
});

describe("P6-1 — advisor recommends the requested layout with a stated reason", () => {
  it("defaults to grouped with no requestedLayout opt", () => {
    const d = buildCrosstabDataset(sheet(), "Diagnosis", "Drug");
    const rec = recommendChart(d);
    expect(rec.type).toBe("bar");
    expect(rec.layout).toBe("grouped");
    expect(rec.reason).toMatch(/grouped/i);
    expect(rec.alternatives.map((a) => a.layout).sort()).toEqual(["stacked", "stacked100"]);
  });

  it("honors requestedLayout and explains the composition/share reasoning", () => {
    const d = buildCrosstabDataset(sheet(), "Diagnosis", "Drug");
    const rec = recommendChart(d, { requestedLayout: "stacked100" });
    expect(rec.layout).toBe("stacked100");
    expect(rec.reason).toMatch(/share|proportion/i);
  });
});
