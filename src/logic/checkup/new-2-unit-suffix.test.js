import { describe, it, expect } from "vitest";
import { stripUnitSuffix } from "./normalizers.js";
import { checkupSheet } from "./scan.js";
import { buildFixPlan } from "./buildFixPlan.js";
import { deriveSheet } from "../workbook.js";

// NEW-2: offer a checkup fix that strips a consistent trailing unit word so
// the cleaned/exported data holds plain numbers.
describe("NEW-2 — stripUnitSuffix normalizer", () => {
  it("reads the number, dropping a trailing unit word", () => {
    expect(stripUnitSuffix("5 Days")).toBe(5);
    expect(stripUnitSuffix("365 Days")).toBe(365);
  });
  it("leaves plain numbers, non-matching text, and N/A alone", () => {
    expect(stripUnitSuffix(3)).toBe(3);
    expect(stripUnitSuffix("N/A")).toBe("N/A");
    expect(stripUnitSuffix("cephalexin")).toBe("cephalexin");
  });
});

describe("NEW-2 — checkup detects a consistent unit-suffix column and offers a fix", () => {
  it("flags a column where most text values share a unit word", () => {
    const sheet = deriveSheet("S", [
      { Duration: "5 Days" }, { Duration: 3 }, { Duration: "365 Days" }, { Duration: "N/A" }, { Duration: "7 Days" },
    ]);
    const findings = checkupSheet(sheet);
    const f = findings.find((x) => x.type === "unitSuffixNumbers");
    expect(f).toBeTruthy();
    expect(f.count).toBe(3);
    expect(f.fix.normalizer).toBe("stripUnitSuffix");
  });

  it("applying the fix leaves N/A untouched and converts the unit-suffixed values to numbers", () => {
    const sheet = deriveSheet("S", [
      { Duration: "5 Days" }, { Duration: 3 }, { Duration: "365 Days" }, { Duration: "N/A" },
    ]);
    const fixes = [{ normalizer: "stripUnitSuffix", column: "Duration" }];
    const { cleanedRows } = buildFixPlan(sheet, fixes);
    expect(cleanedRows.map((r) => r.Duration)).toEqual([5, 3, 365, "N/A"]);
  });
});
