import { describe, it, expect } from "vitest";
import { matchesFilterGroups, applyFilterGroups, previewFilterCount, previewGroupCounts } from "./filterGroups.js";

const rows = [
  { Drug: "cephalexin", Diagnosis: "cystitis", Prescriber: "Dr. A" },
  { Drug: "cephalexin", Diagnosis: "UTI", Prescriber: "Dr. B" },
  { Drug: "amoxicillin", Diagnosis: "UTI", Prescriber: "Dr. A" },
  { Drug: "amoxicillin", Diagnosis: "cystitis", Prescriber: "Dr. B" },
];

describe("item 7: filterGroups (AND-within-group, OR-across-groups)", () => {
  it("no groups (or empty groups) matches every row", () => {
    expect(applyFilterGroups(rows, [])).toEqual(rows);
    expect(applyFilterGroups(rows, [[]])).toEqual(rows);
  });

  it("a single group ANDs its conditions", () => {
    const out = applyFilterGroups(rows, [[{ column: "Drug", value: "cephalexin" }, { column: "Diagnosis", value: "cystitis" }]]);
    expect(out).toEqual([rows[0]]);
  });

  it("two groups OR together (row matches if it matches ANY group)", () => {
    const out = applyFilterGroups(rows, [
      [{ column: "Drug", value: "cephalexin" }, { column: "Diagnosis", value: "cystitis" }],
      [{ column: "Drug", value: "amoxicillin" }, { column: "Diagnosis", value: "UTI" }],
    ]);
    expect(out).toEqual([rows[0], rows[2]]);
  });

  it("matching is foldKey-based (case/spacing insensitive), same as the rest of the app", () => {
    expect(matchesFilterGroups(rows[0], [[{ column: "Drug", value: "  CephaleXin " }]])).toBe(true);
  });

  it("previewFilterCount returns the matching row count without building a dataset", () => {
    const n = previewFilterCount({ rows }, [[{ column: "Drug", value: "cephalexin" }]]);
    expect(n).toBe(2);
  });

  it("previewGroupCounts tallies per-group n after the filter, sorted largest first", () => {
    const out = previewGroupCounts({ rows }, [], ["Prescriber"]);
    expect(out).toEqual([
      { label: "Dr. A", n: 2 },
      { label: "Dr. B", n: 2 },
    ]);
  });

  it("previewGroupCounts supports two group columns (crosstab preview)", () => {
    const out = previewGroupCounts({ rows }, [[{ column: "Diagnosis", value: "UTI" }]], ["Drug", "Prescriber"]);
    expect(out).toEqual(expect.arrayContaining([
      { label: "cephalexin / Dr. B", n: 1 },
      { label: "amoxicillin / Dr. A", n: 1 },
    ]));
    expect(out.length).toBe(2);
  });
});
