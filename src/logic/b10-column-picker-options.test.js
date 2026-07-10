import { describe, it, expect } from "vitest";
import { columnPickerOptions } from "./columnPickerOptions.js";
import { deriveSheet } from "./workbook.js";

function sheet() {
  return deriveSheet("D", Array.from({ length: 20 }, (_, i) => ({
    PatientID: `P${i}`,
    Sex: i % 2 === 0 ? "M" : "F",
    Duration_days: 3 + (i % 7),
  })));
}

describe("B10 — columnPickerOptions", () => {
  it("badges a numeric column as 'number'", () => {
    const opts = columnPickerOptions(sheet(), "any");
    expect(opts.find((o) => o.name === "Duration_days").badge).toBe("number");
  });

  it("badges a text column with its distinct value count", () => {
    const opts = columnPickerOptions(sheet(), "any");
    expect(opts.find((o) => o.name === "Sex").badge).toBe("text · 2 values");
    expect(opts.find((o) => o.name === "PatientID").badge).toBe("text · 20 values");
  });

  it("for the grouping role, puts a low-cardinality text column first, ahead of a high-cardinality ID column", () => {
    const opts = columnPickerOptions(sheet(), "grouping");
    expect(opts[0].name).toBe("Sex");
    expect(opts.find((o) => o.name === "Sex").likely).toBe(true);
    expect(opts.find((o) => o.name === "PatientID").likely).toBe(false);
  });

  it("for the outcome role, puts the numeric column first", () => {
    const opts = columnPickerOptions(sheet(), "outcome");
    expect(opts[0].name).toBe("Duration_days");
    expect(opts[0].likely).toBe(true);
  });

  it("the 'any' role keeps original column order and adds no likely flag", () => {
    const opts = columnPickerOptions(sheet(), "any");
    expect(opts.map((o) => o.name)).toEqual(["PatientID", "Sex", "Duration_days"]);
    expect(opts.every((o) => o.likely === false)).toBe(true);
  });

  it("a high-cardinality ID column (e.g. > 10 distinct values) is not flagged likely for grouping", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ID: `P${i}`, Group: i % 2 === 0 ? "A" : "B" }));
    const opts = columnPickerOptions(deriveSheet("D", rows), "grouping");
    expect(opts.find((o) => o.name === "ID").likely).toBe(false);
    expect(opts.find((o) => o.name === "Group").likely).toBe(true);
  });
});
