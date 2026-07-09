import { describe, it, expect } from "vitest";
import { parseDates, epochSerialToNumber, NORMALIZERS, EXCEL_STEPS } from "./normalizers.js";
import { checkupSheet } from "./scan.js";
import { buildFixPlan } from "./buildFixPlan.js";
import { deriveSheet } from "../workbook.js";
import { replayRecipe } from "../recipes/replay.js";

// P0-1: parseDates must validate month/day/calendar and never corrupt a date.
describe("P0-1 — parseDates validates before rewriting", () => {
  it("rejects an out-of-range month (25/03/2024 as MDY) instead of corrupting it", () => {
    expect(parseDates("25/03/2024", "MDY")).toBe("25/03/2024");
  });
  it("converts 25/03/2024 correctly when the order is DMY", () => {
    expect(parseDates("25/03/2024", "DMY")).toBe("2024-03-25");
  });
  it("rejects Feb 30 as an invalid calendar date", () => {
    expect(parseDates("2/30/2024", "MDY")).toBe("2/30/2024");
  });
  it("rejects 13-05-2024 as MDY (month 13 invalid), leaves it unchanged", () => {
    expect(parseDates("13-05-2024", "MDY")).toBe("13-05-2024");
  });
  it("converts 13-05-2024 correctly as DMY", () => {
    expect(parseDates("13-05-2024", "DMY")).toBe("2024-05-13");
  });
  it("still converts unambiguous M/D/YYYY under default order", () => {
    expect(parseDates("3/15/2024")).toBe("2024-03-15");
  });
  it("leaves already-ISO dates alone", () => {
    expect(parseDates("2024-03-15", "DMY")).toBe("2024-03-15");
  });
});

describe("P0-1 — scan decides date order per column and asks when ambiguous", () => {
  it("picks DMY automatically when a value forces it (first number > 12)", () => {
    const sheet = deriveSheet("S", [
      { StartDate: "25/03/2024" },
      { StartDate: "01/04/2024" },
    ]);
    const findings = checkupSheet(sheet);
    const f = findings.find((x) => x.type === "textDates");
    expect(f).toBeTruthy();
    expect(f.fix.needsPolicy).toBeFalsy();
    expect(f.fix.params.order).toBe("DMY");
    expect(f.count).toBe(2);
  });

  it("picks MDY automatically when a value forces it (second number > 12)", () => {
    const sheet = deriveSheet("S", [
      { StartDate: "03/25/2024" },
      { StartDate: "04/01/2024" },
    ]);
    const findings = checkupSheet(sheet);
    const f = findings.find((x) => x.type === "textDates");
    expect(f).toBeTruthy();
    expect(f.fix.needsPolicy).toBeFalsy();
    expect(f.fix.params.order).toBe("MDY");
  });

  it("asks the user when a column is genuinely ambiguous (every value <= 12/12)", () => {
    const sheet = deriveSheet("S", [
      { StartDate: "03/04/2024" },
      { StartDate: "05/06/2024" },
    ]);
    const findings = checkupSheet(sheet);
    const f = findings.find((x) => x.type === "textDates");
    expect(f).toBeTruthy();
    expect(f.fix.needsPolicy).toBe(true);
    expect(f.fix.policyOptions.map((o) => o.value)).toEqual(["MDY", "DMY"]);
  });

  it("counts unparseable values as could-not-be-read instead of corrupting them", () => {
    const sheet = deriveSheet("S", [
      { StartDate: "25/03/2024" }, // forces DMY, valid (day 25, month 3)
      { StartDate: "31/02/2024" }, // forces DMY too, but Feb 31 is not a real day -> unreadable
    ]);
    const findings = checkupSheet(sheet);
    const f = findings.find((x) => x.type === "textDates");
    expect(f).toBeTruthy();
    expect(f.count).toBe(1);
    expect(f.detail).toMatch(/could not be read/);
  });
});

describe("P0-1 — buildFixPlan replays the recorded order, never re-guesses", () => {
  it("applies the recorded DMY order via the generated transform and Excel step text", () => {
    const sheet = deriveSheet("S", [{ StartDate: "25/03/2024" }, { StartDate: "13-05-2024" }]);
    const fixes = [{ normalizer: "parseDates", column: "StartDate", params: { order: "DMY" } }];
    const { plan, cleanedRows } = buildFixPlan(sheet, fixes);
    expect(cleanedRows[0].StartDate).toBe("2024-03-25");
    expect(cleanedRows[1].StartDate).toBe("2024-05-13");

    const sheets = { S: sheet.rows };
    // eslint-disable-next-line no-new-func
    const out = new Function("sheets", plan.transform_code)(sheets);
    expect(out).toEqual(cleanedRows);

    const step = plan.excel_steps.find((s) => /Standardize the dates/.test(s.title));
    expect(step.instruction).toMatch(/Day\/Month\/Year/);
  });

  it("replay uses the recorded order and does not re-guess", () => {
    const recipe = {
      name: "r1",
      steps: [{ type: "checkupFix", label: "Standardize dates", fix: { normalizer: "parseDates", column: "StartDate", params: { order: "DMY" } } }],
    };
    const sheet = deriveSheet("S", [{ StartDate: "25/03/2024" }]);
    const result = replayRecipe(recipe, sheet, null);
    expect(result.rows[0].StartDate).toBe("2024-03-25");
  });
});

// NEW-1: a real .xlsx duration column stored partly as 1900-epoch date-typed cells.
describe("NEW-1 — epochSerialToNumber recovers numbers that Excel mis-typed as dates", () => {
  it("converts epoch-window date strings back to their integer serial", () => {
    expect(epochSerialToNumber("1899-12-30")).toBe(0);
    expect(epochSerialToNumber("1899-12-31")).toBe(1);
    expect(epochSerialToNumber("1900-01-06")).toBe(7);
  });
  it("leaves real numbers and modern dates alone", () => {
    expect(epochSerialToNumber(7)).toBe(7);
    expect(epochSerialToNumber("2024-03-15")).toBe("2024-03-15");
  });

  it("scan flags a mostly-numeric column with a minority of epoch-window date cells and fixes it without ever writing a 1900 date", () => {
    // Mirrors the real dataset pattern: {7, 5, time(0,0), 1900-01-07, 8} -> {7,5,0,7,8}
    const sheet = deriveSheet("S", [
      { Duration: 7 },
      { Duration: 5 },
      { Duration: "1899-12-30" }, // time(0,0) -> serial 0
      { Duration: "1900-01-06" }, // openpyxl datetime(1900,1,7) -> serial 7 (see workbook.js epoch mapping)
      { Duration: 8 },
    ]);
    const findings = checkupSheet(sheet);
    const f = findings.find((x) => x.type === "epochDates");
    expect(f).toBeTruthy();
    expect(f.count).toBe(2);

    const fixes = [{ normalizer: "epochSerialToNumber", column: "Duration" }];
    const { cleanedRows } = buildFixPlan(sheet, fixes);
    const values = cleanedRows.map((r) => r.Duration);
    expect(values).toEqual([7, 5, 0, 7, 8]);
    expect(values.some((v) => typeof v === "string" && /^1900-/.test(v))).toBe(false);
  });

  it("does not flag a genuine date column", () => {
    const sheet = deriveSheet("S", [{ Visit: "2024-01-05" }, { Visit: "2024-02-10" }]);
    const findings = checkupSheet(sheet);
    expect(findings.find((x) => x.type === "epochDates")).toBeFalsy();
  });
});
