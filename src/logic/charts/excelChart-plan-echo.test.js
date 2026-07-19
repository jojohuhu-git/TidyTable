import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildDataset, buildCrosstabDataset } from "./aggregate.js";
import { excelChartSteps } from "./excelChart.js";
import { recommendChart } from "./advisor.js";

function sheet(rows) { return deriveSheet("D", rows); }

const rows = [
  { Drug: "cephalexin", Diagnosis: "cystitis", Prescriber: "Dr. A", Duration: 3 },
  { Drug: "cephalexin", Diagnosis: "cystitis", Prescriber: "Dr. A", Duration: 5 },
  { Drug: "cephalexin", Diagnosis: "UTI", Prescriber: "Dr. B", Duration: 7 },
  { Drug: "amoxicillin", Diagnosis: "UTI", Prescriber: "Dr. A", Duration: 9 },
  { Drug: "amoxicillin", Diagnosis: "cystitis", Prescriber: "Dr. B", Duration: 20 },
];

describe("item 7: excelChartSteps describes a plan-echo filter-group structure", () => {
  it("describes a single AND-group", () => {
    const filter = { groups: [[{ column: "Drug", value: "cephalexin" }, { column: "Diagnosis", value: "cystitis" }]] };
    const ds = buildDataset(sheet(rows), "Prescriber", null, { filter });
    const steps = excelChartSteps("bar", ds, recommendChart(ds));
    const filterStep = steps.find((s) => s.title === "Remember the filter");
    expect(filterStep).toBeDefined();
    expect(filterStep.instruction).toMatch(/"Drug" is "cephalexin" AND "Diagnosis" is "cystitis"/);
  });

  it("describes multiple OR-groups", () => {
    const filter = { groups: [
      [{ column: "Drug", value: "cephalexin" }],
      [{ column: "Drug", value: "amoxicillin" }],
    ] };
    const ds = buildDataset(sheet(rows), "Prescriber", null, { filter });
    const steps = excelChartSteps("bar", ds, recommendChart(ds));
    const filterStep = steps.find((s) => s.title === "Remember the filter");
    expect(filterStep.instruction).toMatch(/"Drug" is "cephalexin".*OR.*"Drug" is "amoxicillin"/);
  });

  it("a plain single-condition filter is unaffected by the widening (regression)", () => {
    const ds = buildDataset(sheet(rows), "Prescriber", null, { filter: { column: "Drug", value: "cephalexin" } });
    const steps = excelChartSteps("bar", ds, recommendChart(ds));
    const filterStep = steps.find((s) => s.title === "Remember the filter");
    expect(filterStep.instruction).toMatch(/"Drug" is "cephalexin"/);
  });
});

describe("item 7: excelChartSteps' median-by-group array formula step", () => {
  it("fires for a categorical median chart, with both Ctrl+Shift+Enter and plain-Enter guidance", () => {
    const ds = buildDataset(sheet(rows), "Prescriber", "Duration", { aggMode: "median" });
    const steps = excelChartSteps("bar", ds, recommendChart(ds));
    const medianStep = steps.find((s) => s.title.includes("Median by group"));
    expect(medianStep).toBeDefined();
    expect(medianStep.instruction).toMatch(/MEDIAN\(IF\(/);
    expect(medianStep.instruction).toMatch(/Ctrl\+Shift\+Enter/);
    expect(medianStep.instruction).toMatch(/365 or 2021/);
  });

  it("does not fire for a sum or average chart", () => {
    const dsSum = buildDataset(sheet(rows), "Prescriber", "Duration", { aggMode: "sum" });
    const stepsSum = excelChartSteps("bar", dsSum, recommendChart(dsSum));
    expect(stepsSum.find((s) => s.title.includes("Median by group"))).toBeUndefined();

    const dsAvg = buildDataset(sheet(rows), "Prescriber", "Duration", { aggMode: "average" });
    const stepsAvg = excelChartSteps("bar", dsAvg, recommendChart(dsAvg));
    expect(stepsAvg.find((s) => s.title.includes("Median by group"))).toBeUndefined();
  });
});

describe("item 7: excelChartSteps' sort-reproduction step", () => {
  it("fires only when dataset.sort is set (by a confirmed plan), describing direction", () => {
    const ds = buildDataset(sheet(rows), "Prescriber", null, {});
    const withSort = { ...ds, sort: { by: "Prescriber", direction: "asc" } };
    const steps = excelChartSteps("bar", withSort, recommendChart(withSort));
    const sortStep = steps.find((s) => s.title === "Sort to match");
    expect(sortStep).toBeDefined();
    expect(sortStep.instruction).toMatch(/"Prescriber"/);
    expect(sortStep.instruction).toMatch(/smallest to largest/);

    const noSortSteps = excelChartSteps("bar", ds, recommendChart(ds));
    expect(noSortSteps.find((s) => s.title === "Sort to match")).toBeUndefined();
  });
});

describe("item 7: excelChartSteps for a crosstab with a filter group and a median measure", () => {
  it("carries both the filter-group and median-by-group steps", () => {
    const filter = { groups: [[{ column: "Diagnosis", value: "UTI" }]] };
    const ds = buildCrosstabDataset(sheet(rows), "Drug", "Prescriber", { filter, valueCol: "Duration", aggMode: "median" });
    const steps = excelChartSteps("bar", ds, recommendChart(ds));
    expect(steps.find((s) => s.title === "Remember the filter")).toBeDefined();
    expect(steps.find((s) => s.title.includes("Median by group"))).toBeDefined();
  });
});
