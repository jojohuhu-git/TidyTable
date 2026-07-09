import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildDataset } from "./aggregate.js";
import { recommendChart } from "./advisor.js";
import { excelChartSteps } from "./excelChart.js";

function sheet(rows) { return deriveSheet("D", rows); }

describe("aggregate", () => {
  it("counts per category by default", () => {
    const ds = buildDataset(sheet([{ Ward: "A" }, { Ward: "A" }, { Ward: "B" }]), "Ward", null);
    expect(ds.kind).toBe("categorical");
    expect(ds.points).toEqual([{ label: "A", value: 2 }, { label: "B", value: 1 }]);
  });
  it("totals a numeric value column when given one", () => {
    const ds = buildDataset(sheet([{ Ward: "A", Dose: 5 }, { Ward: "A", Dose: 3 }]), "Ward", "Dose");
    expect(ds.points[0]).toEqual({ label: "A", value: 8 });
  });
  it("makes an xy dataset from two number columns", () => {
    const ds = buildDataset(sheet([{ Age: 60, LOS: 4 }, { Age: 70, LOS: 6 }]), "Age", "LOS");
    expect(ds.kind).toBe("xy");
    expect(ds.points).toEqual([{ x: 60, y: 4 }, { x: 70, y: 6 }]);
  });
  it("flags time-like labels", () => {
    const ds = buildDataset(sheet([{ Month: "2024-01", N: 1 }, { Month: "2024-02", N: 2 }]), "Month", "N");
    expect(ds.labelIsTime).toBe(true);
  });
  it("P2-14: sorts time-like labels chronologically even if rows arrive scrambled", () => {
    const ds = buildDataset(
      sheet([{ Month: "2024-03", N: 3 }, { Month: "2024-01", N: 1 }, { Month: "2024-02", N: 2 }]),
      "Month", "N",
    );
    expect(ds.points.map((p) => p.label)).toEqual(["2024-01", "2024-02", "2024-03"]);
  });
  it("P2-14: sorts month-name labels chronologically", () => {
    const ds = buildDataset(
      sheet([{ Month: "Mar 2024", N: 3 }, { Month: "Jan 2024", N: 1 }, { Month: "Feb 2024", N: 2 }]),
      "Month", "N",
    );
    expect(ds.points.map((p) => p.label)).toEqual(["Jan 2024", "Feb 2024", "Mar 2024"]);
  });
  it("P2-14: falls back to first-appearance order when a time label doesn't resolve to a sortable date (e.g. a bare quarter with no year)", () => {
    const ds = buildDataset(
      sheet([{ Q: "Q3", N: 3 }, { Q: "Q1", N: 1 }, { Q: "Q2", N: 2 }]),
      "Q", "N",
    );
    expect(ds.labelIsTime).toBe(true);
    expect(ds.points.map((p) => p.label)).toEqual(["Q3", "Q1", "Q2"]);
  });
  it("P2-14: sorts quarter labels with a year", () => {
    const ds = buildDataset(
      sheet([{ Q: "Q3 2024", N: 3 }, { Q: "Q1 2024", N: 1 }, { Q: "Q2 2024", N: 2 }]),
      "Q", "N",
    );
    expect(ds.points.map((p) => p.label)).toEqual(["Q1 2024", "Q2 2024", "Q3 2024"]);
  });
});

describe("advisor is opinionated", () => {
  const cat = (n) => ({ kind: "categorical", points: Array.from({ length: n }, (_, i) => ({ label: "c" + i, value: i + 1 })) });
  it("recommends a bar for a few categories and offers a pie", () => {
    const rec = recommendChart(cat(3));
    expect(rec.type).toBe("bar");
    expect(rec.alternatives.some((a) => a.type === "pie")).toBe(true);
  });
  it("refuses to offer a pie past 4 slices, with a reason", () => {
    const rec = recommendChart(cat(9));
    expect(rec.alternatives.some((a) => a.type === "pie")).toBe(false);
    expect(rec.noPieReason).toMatch(/9-slice pie/);
  });
  it("recommends a line for time labels", () => {
    expect(recommendChart({ kind: "categorical", labelIsTime: true, points: [{ label: "Jan", value: 1 }] }).type).toBe("line");
  });
  it("recommends a scatter for two numbers", () => {
    expect(recommendChart({ kind: "xy", xName: "Age", yName: "LOS", points: [{ x: 1, y: 2 }] }).type).toBe("scatter");
  });
});

describe("excel chart steps", () => {
  it("start from selecting the range and inserting the chart", () => {
    const steps = excelChartSteps("bar", { kind: "categorical", labelName: "Ward", valueName: "count", points: [] });
    expect(steps[0].instruction).toMatch(/select/i);
    expect(steps[1].instruction).toMatch(/Insert tab/i);
  });
  it("a pie's steps tell you to add data labels", () => {
    const steps = excelChartSteps("pie", { kind: "categorical", labelName: "Ward", valueName: "count", points: [] });
    expect(steps.some((s) => /data labels/i.test(s.instruction))).toBe(true);
  });
});
