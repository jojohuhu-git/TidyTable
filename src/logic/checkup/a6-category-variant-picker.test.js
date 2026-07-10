import { describe, it, expect } from "vitest";
import { checkupSheet } from "./scan.js";
import { deriveSheet } from "../workbook.js";

// A6: findCategoryVariants used to only expose the map to its own default
// canonical choice (most common spelling). It now also exposes each
// fold-group's full spelling list with counts, so the UI can offer the
// choice instead of always defaulting silently.
function sexSheet() {
  return deriveSheet("Patients", [
    { Sex: "Male" }, { Sex: "Male" }, { Sex: "male" }, { Sex: "MALE" },
  ]);
}

describe("A6 — categoryVariants findings expose the full group for a picker", () => {
  it("includes a groups array with every raw spelling and its count", () => {
    const findings = checkupSheet(sexSheet());
    const cv = findings.find((f) => f.type === "categoryVariants" && f.column === "Sex");
    expect(cv.groups).toHaveLength(1);
    const group = cv.groups[0];
    // "Male" (2) is the most common, so it's the default canonical.
    expect(group.canonical).toBe("Male");
    expect(group.variants.sort((a, b) => b.count - a.count)).toEqual([
      { value: "Male", count: 2 },
      { value: "male", count: 1 },
      { value: "MALE", count: 1 },
    ]);
  });

  it("the default fix.params.map still merges into the most-common spelling", () => {
    const findings = checkupSheet(sexSheet());
    const cv = findings.find((f) => f.type === "categoryVariants" && f.column === "Sex");
    expect(cv.fix.params.map).toEqual({ male: "Male", MALE: "Male" });
  });
});
