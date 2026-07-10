import { describe, it, expect } from "vitest";
import { parseDates, isValidCalendarDate } from "./normalizers.js";
import { checkupSheet } from "./scan.js";
import { buildFixPlan } from "./buildFixPlan.js";
import { deriveSheet } from "../workbook.js";

// A5: the checkup scan used to keep its own copy of the calendar-validity
// check, separate from parseDates's. They happened to agree, but nothing
// guaranteed it — a future tweak to one could silently leave the log vouching
// for a date parseDates would actually refuse to rewrite. Both now call the
// same exported isValidCalendarDate, so the log can never disagree with what
// the fix actually does.
describe("A5 — the cleaning-log date finding agrees with parseDates, by construction", () => {
  it("scan's reported 'valid' count matches exactly how many parseDates will actually rewrite", () => {
    const sheet = deriveSheet("S", [
      { StartDate: "03/15/2024" }, // valid MDY
      { StartDate: "02/30/2024" }, // invalid: Feb 30
      { StartDate: "03/10/2024" }, // valid MDY
    ]);
    const findings = checkupSheet(sheet);
    const f = findings.find((x) => x.type === "textDates");
    expect(f.count).toBe(2); // only the two real dates
    expect(f.detail).toMatch(/1 value could not be read as a valid date/);

    const fixes = [{ normalizer: "parseDates", column: "StartDate", params: { order: "MDY" } }];
    const { cleanedRows } = buildFixPlan(sheet, fixes);
    const actuallyRewritten = cleanedRows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.StartDate)).length;
    expect(actuallyRewritten).toBe(f.count);
    expect(cleanedRows[1].StartDate).toBe("02/30/2024"); // left alone, not silently guessed
  });

  it("the worker transform_code (with isValidCalendarDate inlined) rejects the same invalid date parseDates rejects", () => {
    const sheet = deriveSheet("S", [{ StartDate: "02/30/2024" }, { StartDate: "03/15/2024" }]);
    const fixes = [{ normalizer: "parseDates", column: "StartDate", params: { order: "MDY" } }];
    const { plan, cleanedRows } = buildFixPlan(sheet, fixes);
    expect(plan.transform_code).toMatch(/function isValidCalendarDate/);

    const sheets = { S: sheet.rows };
    // eslint-disable-next-line no-new-func
    const out = new Function("sheets", plan.transform_code)(sheets);
    expect(out).toEqual(cleanedRows);
    expect(out[0].StartDate).toBe("02/30/2024");
    expect(out[1].StartDate).toBe("2024-03-15");
  });

  it("isValidCalendarDate is the single shared source parseDates itself calls", () => {
    expect(parseDates.toString()).toMatch(/isValidCalendarDate\(/);
    expect(isValidCalendarDate(2024, 2, 30)).toBe(false);
    expect(isValidCalendarDate(2024, 3, 15)).toBe(true);
  });
});
