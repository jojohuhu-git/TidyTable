import { describe, it, expect } from "vitest";
import { summarizePlan } from "./planSummary.js";

describe("item 7: summarizePlan (generic literal template only)", () => {
  it("matches the spec's own worked example exactly", () => {
    const plan = {
      filterGroups: [[{ column: "Drug", value: "cephalexin" }, { column: "Diagnosis", value: "cystitis" }]],
      measure: { col: "Duration_days", aggMode: "average" },
      groupCols: ["Prescriber"],
      sort: { by: "Prescriber", direction: "asc" },
    };
    expect(summarizePlan(plan)).toBe(
      "Average of Duration_days, for rows where Drug = cephalexin and Diagnosis = cystitis, grouped by Prescriber, sorted by Prescriber."
    );
  });

  it("count with no filter/group/sort reads as a bare count of rows", () => {
    const plan = { filterGroups: [[]], measure: { col: null, aggMode: "count" }, groupCols: [], sort: null };
    expect(summarizePlan(plan)).toBe("Count of rows.");
  });

  it("multiple OR-groups render with 'or' joining each AND-group", () => {
    const plan = {
      filterGroups: [
        [{ column: "Drug", value: "cephalexin" }, { column: "Diagnosis", value: "cystitis" }],
        [{ column: "Drug", value: "amoxicillin" }, { column: "Diagnosis", value: "UTI" }],
      ],
      measure: { col: null, aggMode: "count" },
      groupCols: [],
      sort: null,
    };
    expect(summarizePlan(plan)).toBe(
      "Count of rows, for rows where Drug = cephalexin and Diagnosis = cystitis, or Drug = amoxicillin and Diagnosis = UTI."
    );
  });

  it("two group columns join with 'and'", () => {
    const plan = { filterGroups: [[]], measure: { col: "Duration", aggMode: "median" }, groupCols: ["Ward", "Diagnosis"], sort: null };
    expect(summarizePlan(plan)).toBe("Median of Duration, grouped by Ward and Diagnosis.");
  });

  it("every word in the output traces to a real field value in the plan (never synthesized phrasing)", () => {
    const plan = {
      filterGroups: [[{ column: "Drug", value: "cephalexin" }]],
      measure: { col: "Duration_days", aggMode: "sum" },
      groupCols: ["Prescriber"],
      sort: { by: "Prescriber", direction: "desc" },
    };
    const out = summarizePlan(plan);
    const allowedWords = new Set([
      "sum", "of", "duration_days,", "for", "rows", "where", "drug", "=", "cephalexin,",
      "grouped", "by", "prescriber,", "sorted", "cephalexin.", "prescriber.",
    ]);
    for (const word of out.toLowerCase().replace(/\./g, ".").split(/\s+/)) {
      expect(allowedWords.has(word)).toBe(true);
    }
  });
});
