import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildDataset, buildCrosstabDataset } from "./aggregate.js";

function sheet(rows) { return deriveSheet("D", rows); }

describe("item 7: median measure", () => {
  it("buildDataset computes a per-group median (even count, interpolated)", () => {
    // Ward A: 3,5,5,7,9,20 -> median 6 (avg of 5 and 7)
    const rows = [
      { Ward: "A", Duration: 3 }, { Ward: "A", Duration: 5 }, { Ward: "A", Duration: 5 },
      { Ward: "A", Duration: 7 }, { Ward: "A", Duration: 9 }, { Ward: "A", Duration: 20 },
    ];
    const ds = buildDataset(sheet(rows), "Ward", "Duration", { aggMode: "median" });
    expect(ds.points).toEqual([{ label: "A", value: 6 }]);
    expect(ds.valueName).toBe("median Duration");
  });

  it("buildDataset computes a per-group median (odd count, no interpolation)", () => {
    // Ward B: 1,2,100 -> median 2
    const rows = [{ Ward: "B", Duration: 1 }, { Ward: "B", Duration: 2 }, { Ward: "B", Duration: 100 }];
    const ds = buildDataset(sheet(rows), "Ward", "Duration", { aggMode: "median" });
    expect(ds.points).toEqual([{ label: "B", value: 2 }]);
  });

  it("buildDataset drops (never zeroes) a median group with no readable numbers", () => {
    const rows = [{ Ward: "A", Duration: "N/A" }, { Ward: "A", Duration: "pending" }];
    const ds = buildDataset(sheet(rows), "Ward", "Duration", { aggMode: "median" });
    expect(ds.points).toEqual([]);
    expect(ds.noDataGroups).toEqual(["A"]);
  });

  it("buildDataset median ignores unreadable cells within an otherwise-valid group", () => {
    const rows = [
      { Ward: "A", Duration: 3 }, { Ward: "A", Duration: "N/A" }, { Ward: "A", Duration: 5 },
    ];
    const ds = buildDataset(sheet(rows), "Ward", "Duration", { aggMode: "median" });
    expect(ds.points).toEqual([{ label: "A", value: 4 }]);
  });

  it("buildCrosstabDataset stays count-only when no valueCol/aggMode is given (unchanged existing behavior)", () => {
    const rows = [
      { Ward: "A", Drug: "X" }, { Ward: "A", Drug: "X" }, { Ward: "A", Drug: "Y" }, { Ward: "B", Drug: "X" },
    ];
    const ds = buildCrosstabDataset(sheet(rows), "Ward", "Drug");
    expect(ds.categories.find((c) => c.label === "A").total).toBe(3);
  });

  it("buildCrosstabDataset supports a real average measure per cell", () => {
    const rows = [
      { Ward: "A", Drug: "X", Duration: 4 }, { Ward: "A", Drug: "X", Duration: 6 },
      { Ward: "A", Drug: "Y", Duration: 10 },
      { Ward: "B", Drug: "X", Duration: 2 },
    ];
    const ds = buildCrosstabDataset(sheet(rows), "Ward", "Drug", { valueCol: "Duration", aggMode: "average" });
    const a = ds.categories.find((c) => c.label === "A");
    const xIdx = ds.subgroups.indexOf("X");
    const yIdx = ds.subgroups.indexOf("Y");
    expect(a.values[xIdx]).toBe(5);
    expect(a.values[yIdx]).toBe(10);
    // a sum-of-per-cell-averages is not a meaningful "total" -- must not be invented
    expect(a.total).toBeNull();
  });

  it("buildCrosstabDataset supports a real median measure per cell", () => {
    const rows = [
      { Ward: "A", Drug: "X", Duration: 1 }, { Ward: "A", Drug: "X", Duration: 2 }, { Ward: "A", Drug: "X", Duration: 100 },
    ];
    const ds = buildCrosstabDataset(sheet(rows), "Ward", "Drug", { valueCol: "Duration", aggMode: "median" });
    const a = ds.categories.find((c) => c.label === "A");
    const xIdx = ds.subgroups.indexOf("X");
    expect(a.values[xIdx]).toBe(2);
  });

  it("buildCrosstabDataset keeps a real total for a sum measure", () => {
    const rows = [
      { Ward: "A", Drug: "X", Duration: 4 }, { Ward: "A", Drug: "Y", Duration: 10 },
    ];
    const ds = buildCrosstabDataset(sheet(rows), "Ward", "Drug", { valueCol: "Duration", aggMode: "sum" });
    const a = ds.categories.find((c) => c.label === "A");
    expect(a.total).toBe(14);
  });
});
