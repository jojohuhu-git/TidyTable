import { describe, it, expect } from "vitest";
import { rChartPlan } from "./chartPlan.js";

describe("item 7: rChartPlan — R script generator for a confirmed plan-echo plan", () => {
  it("no filter, no group, count: a bare row count", () => {
    const plan = { filterGroups: [[]], measure: { col: null, aggMode: "count" }, groupCols: [], sort: null };
    const { script } = rChartPlan(plan);
    expect(script).toMatch(/filtered <- data/);
    expect(script).toMatch(/result <- filtered %>% summarise\(n = n\(\)\)/);
    expect(script).toMatch(/print\(result\)/);
  });

  it("a single AND-group filter uses & between conditions", () => {
    const plan = {
      filterGroups: [[{ column: "Drug", value: "cephalexin" }, { column: "Diagnosis", value: "cystitis" }]],
      measure: { col: null, aggMode: "count" },
      groupCols: [],
      sort: null,
    };
    const { script } = rChartPlan(plan);
    expect(script).toMatch(/filter\(data\[\["Drug"\]\] == "cephalexin" & data\[\["Diagnosis"\]\] == "cystitis"\)/);
  });

  it("multiple OR-groups bind_rows the per-group filtered frames and de-duplicate", () => {
    const plan = {
      filterGroups: [
        [{ column: "Drug", value: "cephalexin" }, { column: "Diagnosis", value: "cystitis" }],
        [{ column: "Drug", value: "amoxicillin" }, { column: "Diagnosis", value: "UTI" }],
      ],
      measure: { col: null, aggMode: "count" },
      groupCols: [],
      sort: null,
    };
    const { script } = rChartPlan(plan);
    expect(script).toMatch(/group1 <- data %>% filter\(.*cephalexin.*cystitis.*\)/);
    expect(script).toMatch(/group2 <- data %>% filter\(.*amoxicillin.*UTI.*\)/);
    expect(script).toMatch(/filtered <- bind_rows\(group1, group2\) %>% distinct\(\)/);
  });

  it("grouped average measure", () => {
    const plan = {
      filterGroups: [[]],
      measure: { col: "Duration_days", aggMode: "average" },
      groupCols: ["Prescriber"],
      sort: null,
    };
    const { script } = rChartPlan(plan);
    expect(script).toMatch(/group_by\(`Prescriber` = data\[\["Prescriber"\]\]\)/);
    expect(script).toMatch(/summarise\(average = mean\(data\[\["Duration_days"\]\], na\.rm = TRUE\), \.groups = "drop"\)/);
  });

  it("median measure", () => {
    const plan = { filterGroups: [[]], measure: { col: "Duration_days", aggMode: "median" }, groupCols: ["Ward"], sort: null };
    const { script } = rChartPlan(plan);
    expect(script).toMatch(/median\(data\[\["Duration_days"\]\], na\.rm = TRUE\)/);
  });

  it("two group columns (crosstab)", () => {
    const plan = { filterGroups: [[]], measure: { col: "Duration_days", aggMode: "sum" }, groupCols: ["Ward", "Diagnosis"], sort: null };
    const { script } = rChartPlan(plan);
    expect(script).toMatch(/group_by\(`Ward` = data\[\["Ward"\]\], `Diagnosis` = data\[\["Diagnosis"\]\]\)/);
  });

  it("sort descending by the measure", () => {
    const plan = {
      filterGroups: [[]],
      measure: { col: "Duration_days", aggMode: "average" },
      groupCols: ["Prescriber"],
      sort: { by: "Duration_days", direction: "desc" },
    };
    const { script } = rChartPlan(plan);
    expect(script).toMatch(/arrange\(desc\(average\)\)/);
  });

  it("sort ascending by the group label", () => {
    const plan = {
      filterGroups: [[]],
      measure: { col: null, aggMode: "count" },
      groupCols: ["Prescriber"],
      sort: { by: "Prescriber", direction: "asc" },
    };
    const { script } = rChartPlan(plan);
    expect(script).toMatch(/arrange\(`Prescriber`\)/);
  });

  it("installs and loads dplyr, and wraps with the shared beginner header", () => {
    const plan = { filterGroups: [[]], measure: { col: null, aggMode: "count" }, groupCols: [], sort: null };
    const { script, r_run_notes } = rChartPlan(plan);
    expect(script).toMatch(/if \(!require\("dplyr"\)\) install\.packages\("dplyr"\)/);
    expect(script).toMatch(/library\(dplyr\)/);
    expect(script).toMatch(/read_excel\(file\.choose\(\)\)/); // shared HEADER
    expect(r_run_notes).toMatch(/result/i);
  });
});
