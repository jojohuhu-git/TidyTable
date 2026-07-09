import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildFixPlan } from "./buildFixPlan.js";

// P1-8: the older-Excel VLOOKUP fallback for trimCase used a one-column
// range with column index 1 (`VLOOKUP(C2,$Y$2:$Y$N,1,FALSE)`), which returns
// the *old* spelling — a formula that silently does nothing. It must be a
// two-column range with index 2. The lookup table was also hardcoded to
// columns Y/Z, which can collide with real data on a wide sheet or with
// another fix's own helper column allocated from the same sequence.

function sheetWithColumns(n) {
  const row = {};
  for (let i = 0; i < n; i++) row[`Col${i}`] = i;
  row.Sex = "male";
  return deriveSheet("Wide", [row, { ...row }]);
}

describe("P1-8 — trimCase's VLOOKUP fallback and helper-column allocation", () => {
  it("the VLOOKUP fallback uses a two-column range and column index 2", () => {
    const sheet = deriveSheet("Patients", [{ Sex: "male" }, { Sex: "Male" }]);
    const fixes = [{ normalizer: "trimCase", column: "Sex", params: { map: { male: "Male" } } }];
    const { plan } = buildFixPlan(sheet, fixes);
    const step = plan.excel_steps.find((s) => s.title.includes("Merge the spellings"));
    const vlookupMatch = step.instruction.match(/VLOOKUP\([^,]+,(\$[A-Z]+\$\d+:\$[A-Z]+\$\d+),(\d+),FALSE\)/);
    expect(vlookupMatch).not.toBeNull();
    const range = vlookupMatch[1];
    const index = vlookupMatch[2];
    expect(index).toBe("2");
    // A real two-column range like $C$2:$D$2, not a one-column range.
    const [fromCol, toCol] = range.replace(/\$/g, "").split(":").map((c) => c.match(/[A-Z]+/)[0]);
    expect(fromCol).not.toBe(toCol);
  });

  it("the lookup columns are allocated from the helper sequence, not hardcoded to Y/Z", () => {
    const sheet = deriveSheet("Patients", [{ Sex: "male" }, { Sex: "Male" }]);
    const fixes = [{ normalizer: "trimCase", column: "Sex", params: { map: { male: "Male" } } }];
    const { plan } = buildFixPlan(sheet, fixes);
    const step = plan.excel_steps.find((s) => s.title.includes("Merge the spellings"));
    // One data column (Sex) means the result helper is column B, and the two
    // lookup columns should be C and D — not Y/Z.
    expect(step.where).toContain("columns C and D");
    expect(step.formula).toContain("$C$2:$C$2");
    expect(step.formula).toContain("$D$2:$D$2");
  });

  it("lookup columns don't collide with real data on a 30-column sheet", () => {
    const sheet = sheetWithColumns(30);
    const fixes = [{ normalizer: "trimCase", column: "Sex", params: { map: { male: "Male" } } }];
    const { plan } = buildFixPlan(sheet, fixes);
    const step = plan.excel_steps.find((s) => s.title.includes("Merge the spellings"));
    const dataColumnLetters = new Set(sheet.headers.map((h) => h.letter));
    const lookupLetters = step.where.match(/columns ([A-Z]+) and ([A-Z]+)/).slice(1, 3);
    for (const letter of lookupLetters) expect(dataColumnLetters.has(letter)).toBe(false);
  });

  it("lookup columns don't collide with another fix's own helper column", () => {
    const sheet = deriveSheet("Patients", [
      { Sex: "male", Dose: "$1,200" },
      { Sex: "Male", Dose: "250" },
    ]);
    const fixes = [
      { normalizer: "coerceNumbers", column: "Dose", params: {} },
      { normalizer: "trimCase", column: "Sex", params: { map: { male: "Male" } } },
    ];
    const { plan } = buildFixPlan(sheet, fixes);
    const doseStep = plan.excel_steps.find((s) => s.title.includes("Dose"));
    const trimStep = plan.excel_steps.find((s) => s.title.includes("Merge the spellings"));
    const doseHelperLetter = doseStep.where.match(/cell ([A-Z]+)2/)[1];
    const trimHelperLetter = trimStep.where.match(/fill down to ([A-Z]+)\d/)[1];
    const [fromLetter, toLetter] = trimStep.where.match(/columns ([A-Z]+) and ([A-Z]+)/).slice(1, 3);
    const used = new Set([doseHelperLetter, trimHelperLetter, fromLetter, toLetter]);
    expect(used.size).toBe(4); // all four helper columns are distinct
  });
});
