import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildDataset } from "./aggregate.js";
import { buildChartTitle } from "./chartTitle.js";

function sheet(rows) { return deriveSheet("D", rows); }

describe("B9 — non-time categorical bars sort largest first", () => {
  it("sorts by value descending when labels aren't time-like", () => {
    const ds = buildDataset(
      sheet([{ Dx: "pneumonia" }, { Dx: "UTI" }, { Dx: "UTI" }, { Dx: "UTI" }, { Dx: "cystitis" }, { Dx: "cystitis" }]),
      "Dx", null,
    );
    expect(ds.points.map((p) => p.label)).toEqual(["UTI", "cystitis", "pneumonia"]);
  });

  it("does not reorder time-like labels (chronological sort still wins there)", () => {
    const ds = buildDataset(
      sheet([{ Month: "2024-03", N: 1 }, { Month: "2024-01", N: 100 }, { Month: "2024-02", N: 2 }]),
      "Month", "N",
    );
    expect(ds.points.map((p) => p.label)).toEqual(["2024-01", "2024-02", "2024-03"]);
  });
});

describe("B9 — buildChartTitle", () => {
  it("names the value and the label column for a categorical count", () => {
    const ds = buildDataset(sheet([{ Dx: "UTI" }, { Dx: "UTI" }]), "Dx", null);
    expect(buildChartTitle(ds)).toBe("count by Dx");
  });

  it("names a totaled numeric column", () => {
    const ds = buildDataset(sheet([{ Dx: "UTI", Cost: 5 }, { Dx: "UTI", Cost: 3 }]), "Dx", "Cost");
    expect(buildChartTitle(ds)).toBe("total Cost by Dx");
  });

  it("names both axes for an xy/scatter dataset", () => {
    const ds = buildDataset(sheet([{ Age: 60, LOS: 4 }, { Age: 70, LOS: 6 }]), "Age", "LOS");
    expect(buildChartTitle(ds)).toBe("LOS vs Age");
  });
});
