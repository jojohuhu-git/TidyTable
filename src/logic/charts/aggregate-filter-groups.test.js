import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildDataset, buildCrosstabDataset } from "./aggregate.js";

function sheet(rows) { return deriveSheet("D", rows); }

const rows = [
  { Drug: "cephalexin", Diagnosis: "cystitis", Prescriber: "Dr. A", Duration: 5 },
  { Drug: "cephalexin", Diagnosis: "UTI", Prescriber: "Dr. B", Duration: 7 },
  { Drug: "amoxicillin", Diagnosis: "UTI", Prescriber: "Dr. A", Duration: 10 },
  { Drug: "amoxicillin", Diagnosis: "cystitis", Prescriber: "Dr. B", Duration: 3 },
];

describe("item 7: aggregate.js filter dispatch accepts a filter-group structure", () => {
  it("the old single-condition {column,value} shape still works unchanged (regression guard)", () => {
    const ds = buildDataset(sheet(rows), "Prescriber", null, { filter: { column: "Drug", value: "cephalexin" } });
    expect(ds.points).toEqual([{ label: "Dr. A", value: 1 }, { label: "Dr. B", value: 1 }]);
    expect(ds.filter).toEqual({ column: "Drug", value: "cephalexin" });
  });

  it("buildDataset applies a filter-group structure (AND-within, OR-across)", () => {
    const filter = { groups: [
      [{ column: "Drug", value: "cephalexin" }, { column: "Diagnosis", value: "cystitis" }],
      [{ column: "Drug", value: "amoxicillin" }, { column: "Diagnosis", value: "UTI" }],
    ] };
    const ds = buildDataset(sheet(rows), "Prescriber", null, { filter });
    // matches row 0 (Dr. A) and row 2 (Dr. A) -> Dr. A: 2
    expect(ds.points).toEqual([{ label: "Dr. A", value: 2 }]);
  });

  it("buildCrosstabDataset applies a filter-group structure the same way", () => {
    const filter = { groups: [[{ column: "Diagnosis", value: "UTI" }]] };
    const ds = buildCrosstabDataset(sheet(rows), "Drug", "Prescriber", { filter });
    const ceph = ds.categories.find((c) => c.label === "cephalexin");
    expect(ceph.total).toBe(1); // only the UTI row for cephalexin
  });

  it("a filter with no real groups behaves like no filter at all", () => {
    const ds = buildDataset(sheet(rows), "Prescriber", null, { filter: { groups: [[]] } });
    expect(ds.points.reduce((s, p) => s + p.value, 0)).toBe(4);
  });
});
