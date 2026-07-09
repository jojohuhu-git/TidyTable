import { describe, it, expect } from "vitest";
import { buildExampleWorkbook } from "./exampleWorkbook.js";
import { checkupSheet } from "./checkup/scan.js";
import { matchRequest } from "./offline/matcher.js";

// B2: the example workbook exists so a novice can try the app risk-free. It
// must actually be messy in the ways the checkup step advertises finding, and
// a plain question against it must resolve offline — otherwise the "try it"
// button would teach the same lesson A4 already fixed (the app looks broken).
describe("B2 — the built-in example workbook is genuinely messy and usable", () => {
  it("has two sheets so the reshape step (10) has something to work with", () => {
    const wb = buildExampleWorkbook();
    expect(wb.sheets.map((s) => s.name)).toEqual(["Encounters", "Roster"]);
    expect(wb.isExample).toBe(true);
  });

  it("the checkup step finds a duplicate row, a missing value, and a censored value", () => {
    const wb = buildExampleWorkbook();
    const findings = checkupSheet(wb.sheets[0]);
    const types = findings.map((f) => f.type);
    expect(types).toContain("duplicateRows");
    expect(types).toContain("missing");
    expect(types).toContain("censored");
  });

  it("a plain question resolves offline with no key needed", () => {
    const wb = buildExampleWorkbook();
    // P4 repeats across two rows, so this legitimately asks the grain question
    // rather than declining — either way it's an offline resolution, not "none".
    const result = matchRequest("how many patients with UTI", wb, { present: false });
    expect(["confident", "grain"]).toContain(result.status);
  });
});
