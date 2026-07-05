import { describe, it, expect } from "vitest";
import { checkupSheet } from "./scan.js";
import { buildFixPlan } from "./buildFixPlan.js";
import { formatCleaningLog, makeLogEvent } from "./cleaningLog.js";
import { deriveSheet } from "../workbook.js";
import {
  coerceNumbers, sentinelBlanks, parseDates, trimCase, censoredValues, splitList,
} from "./normalizers.js";

// Scenario 1 fixture: duplicates + text-numbers + M/Male/male + one "<0.5".
function messySheet() {
  const rows = [
    { PatientID: "P001", Sex: "M", Result: "0.8", Dose: "$1,200" },
    { PatientID: "P002", Sex: "Male", Result: "<0.5", Dose: "250" },
    { PatientID: "P003", Sex: "male", Result: "1.2", Dose: "1,000" },
    { PatientID: "P001", Sex: "M", Result: "0.8", Dose: "$1,200" }, // exact duplicate of row 1
    { PatientID: "P004", Sex: "female", Result: "0.9", Dose: " 5 " },
  ];
  return deriveSheet("Patients", rows);
}

// Run the generated transform exactly as the Web Worker does.
function runPlan(plan, sheet) {
  const sheets = { [sheet.name]: sheet.rows };
  // eslint-disable-next-line no-new-func
  return new Function("sheets", plan.transform_code)(sheets);
}

describe("normalizers (pure)", () => {
  it("coerceNumbers strips $, commas, spaces", () => {
    expect(coerceNumbers("$1,200")).toBe(1200);
    expect(coerceNumbers(" 5 ")).toBe(5);
    expect(coerceNumbers("abc")).toBe("abc");
  });
  it("sentinelBlanks nulls out stand-ins", () => {
    expect(sentinelBlanks("N/A")).toBe(null);
    expect(sentinelBlanks("-")).toBe(null);
    expect(sentinelBlanks("real")).toBe("real");
  });
  it("parseDates normalizes M/D/YYYY", () => {
    expect(parseDates("3/15/2024")).toBe("2024-03-15");
    expect(parseDates("2024-03-15")).toBe("2024-03-15");
  });
  it("trimCase maps variants to canonical", () => {
    expect(trimCase("male", { male: "Male" })).toBe("Male");
    expect(trimCase("Female", { male: "Male" })).toBe("Female");
  });
  it("censoredValues respects policy", () => {
    expect(censoredValues("<0.5", "boundary")).toBe(0.5);
    expect(censoredValues("<0.5", "missing")).toBe(null);
    expect(censoredValues("<0.5", "exclude")).toBe("<0.5");
    expect(censoredValues("pending", "missing")).toBe(null);
  });
  it("splitList splits on commas/semicolons", () => {
    expect(splitList("red, blue")).toEqual(["red", "blue"]);
    expect(splitList("solo")).toEqual(["solo"]);
  });
});

describe("checkupSheet detects the messy fixture", () => {
  const findings = checkupSheet(messySheet());
  const byType = (t) => findings.filter((f) => f.type === t);

  it("finds the duplicate row", () => {
    const dup = byType("duplicateRows");
    expect(dup).toHaveLength(1);
    expect(dup[0].count).toBe(1);
  });
  it("finds text numbers in Dose with a count and samples", () => {
    const tn = byType("textNumbers").find((f) => f.column === "Dose");
    expect(tn).toBeTruthy();
    // Scan runs before dedupe, so the duplicate row's "$1,200" counts too:
    // $1,200 · 1,000 · " 5 " · $1,200(dup) = 4.
    expect(tn.count).toBe(4);
    expect(tn.samples.length).toBeGreaterThan(0);
  });
  it("proposes a case/space merge for Sex (male -> Male), honestly leaving M alone", () => {
    const cv = byType("categoryVariants").find((f) => f.column === "Sex");
    expect(cv).toBeTruthy();
    expect(cv.fix.params.map).toEqual({ male: "Male" });
  });
  it("flags the censored result and marks it as needing a policy question", () => {
    const c = byType("censored").find((f) => f.column === "Result");
    expect(c).toBeTruthy();
    expect(c.fix.needsPolicy).toBe(true);
    expect(c.samples).toContain("<0.5");
  });
});

describe("buildFixPlan applies three fixes correctly", () => {
  const sheet = messySheet();
  const fixes = [
    { normalizer: "dedupeRows" },
    { normalizer: "coerceNumbers", column: "Dose" },
    { normalizer: "trimCase", column: "Sex", params: { map: { male: "Male" } } },
  ];
  const { plan, log, cleanedRows } = buildFixPlan(sheet, fixes);

  it("is tagged as an offline plan", () => {
    expect(plan.engine).toBe("offline");
  });

  it("the generated transform produces the same rows as the simulation", () => {
    const out = runPlan(plan, sheet);
    expect(out.length).toBe(cleanedRows.length);
    expect(out).toEqual(cleanedRows);
  });

  it("removes the duplicate and cleans the values", () => {
    const out = runPlan(plan, sheet);
    expect(out).toHaveLength(4); // 5 rows minus 1 exact duplicate
    expect(out.every((r) => typeof r.Dose === "number")).toBe(true);
    expect(out.find((r) => r.PatientID === "P003").Sex).toBe("Male");
    // M was NOT silently guessed into Male.
    expect(out.find((r) => r.PatientID === "P001").Sex).toBe("M");
  });

  it("emits Excel helper-column steps for the value fixes", () => {
    const doseStep = plan.excel_steps.find((s) => /Dose/.test(s.title));
    expect(doseStep.formula).toMatch(/VALUE\(/);
    expect(doseStep.where).toMatch(/fill down/i);
    expect(plan.excel_steps.some((s) => /Remove Duplicates/i.test(s.instruction))).toBe(true);
  });

  it("writes an honest cleaning log with before/after counts", () => {
    const text = formatCleaningLog([makeLogEvent({ fileName: "patients.xlsx", sheet: sheet.name, entries: log })]);
    expect(text).toMatch(/Removed duplicate rows/);
    expect(text).toMatch(/1 row removed, 5 to 4/);
    expect(text).toMatch(/Result: 4 rows/);
  });
});
