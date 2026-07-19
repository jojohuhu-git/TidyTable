import { describe, it, expect } from "vitest";
import { checkupSheet, idColumnRole } from "./scan.js";
import { buildFixPlan } from "./buildFixPlan.js";
import { dedupeEncounterRows, keepOneRowPerPatient } from "./normalizers.js";
import { replayRecipe } from "../recipes/replay.js";
import { newRecipe, addStep, checkupStep } from "../recipes/recipe.js";
import { deriveSheet } from "../workbook.js";

// Parked item 3 (2026-07-18): Step-2 duplicate CSN/MRN handling. All fixtures
// are synthetic — never real patient data.

// A CSN column that is NOT mostly-unique (3 distinct of 5), so the old
// looks-unique detector would stay silent — name recognition must carry it.
// One duplicate pair is an exact row copy; the other pair differs.
function encounterSheet() {
  const rows = [
    { CSN: "1001", MRN: "A1", Visit_date: "2026-01-05", Ward: "ICU", Drug: "cefepime" },
    { CSN: "1002", MRN: "A2", Visit_date: "2026-01-06", Ward: "Peds", Drug: "amoxicillin" },
    { CSN: "1001", MRN: "A1", Visit_date: "2026-01-05", Ward: "ICU", Drug: "cefepime" }, // exact copy
    { CSN: "1003", MRN: "A3", Visit_date: "2026-01-07", Ward: "Peds", Drug: "ceftriaxone" },
    { CSN: "1003", MRN: "A3", Visit_date: "2026-01-08", Ward: "NICU", Drug: "ceftriaxone" }, // same CSN, differs
  ];
  return deriveSheet("Encounters", rows);
}

// An MRN column where repeats are legitimate (multiple visits per patient),
// plus a blank-MRN row and a blank-date row to pin the never-drop edges.
function patientSheet() {
  const rows = [
    { MRN: "M1", Visit_date: "2026-01-05", Ward: "ICU", Note: "a" },
    { MRN: "M1", Visit_date: "2026-02-01", Ward: "Peds", Note: null },
    { MRN: "M2", Visit_date: "2026-01-10", Ward: "Peds", Note: "b" },
    { MRN: null, Visit_date: "2026-01-11", Ward: "ER", Note: "c" },
    { MRN: "M3", Visit_date: null, Ward: "ER", Note: null },
    { MRN: "M3", Visit_date: "2026-01-20", Ward: "ICU", Note: "d" },
  ];
  return deriveSheet("Visits", rows);
}

function runPlan(plan, sheet) {
  const sheets = { [sheet.name]: sheet.rows };
  // eslint-disable-next-line no-new-func
  return new Function("sheets", plan.transform_code)(sheets);
}

describe("idColumnRole — (a) name-based recognition", () => {
  it("recognizes encounter-ID names", () => {
    expect(idColumnRole("CSN")).toBe("encounter");
    expect(idColumnRole("csn")).toBe("encounter");
    expect(idColumnRole("PAT_ENC_CSN_ID")).toBe("encounter");
    expect(idColumnRole("Encounter ID")).toBe("encounter");
    expect(idColumnRole("encounter_id")).toBe("encounter");
  });
  it("recognizes patient-ID names", () => {
    expect(idColumnRole("MRN")).toBe("patient");
    expect(idColumnRole("mrn")).toBe("patient");
    expect(idColumnRole("Medical Record Number")).toBe("patient");
    expect(idColumnRole("Patient ID")).toBe("patient");
    expect(idColumnRole("patient_id")).toBe("patient");
    expect(idColumnRole("PatientID")).toBe("patient");
  });
  it("does not fire on ordinary columns", () => {
    expect(idColumnRole("Ward")).toBe(null);
    expect(idColumnRole("Duration_days")).toBe(null);
    expect(idColumnRole("Result")).toBe(null);
    expect(idColumnRole("Patient name")).toBe(null); // no id/number word
    expect(idColumnRole("confirm number")).toBe(null);
  });
});

describe("scan — (b) duplicate encounter IDs", () => {
  it("flags duplicate CSNs by name even when the column is not mostly-unique", () => {
    const findings = checkupSheet(encounterSheet());
    const f = findings.find((x) => x.type === "duplicateEncounterIds");
    expect(f).toBeTruthy();
    expect(f.column).toBe("CSN");
    expect(f.count).toBe(2); // two CSNs appear more than once
    expect(f.exactCopyCount).toBe(1); // one row is removable as an exact copy
    expect(f.differingGroups.length).toBe(1);
    expect(f.differingGroups[0].id).toBe("1003");
    expect(f.differingGroups[0].rows.length).toBe(2);
    expect(f.fixable).toBe(true);
    expect(f.fix.normalizer).toBe("dedupeEncounters");
  });
  it("suppresses the generic looks-unique finding for a name-recognized column", () => {
    const findings = checkupSheet(encounterSheet());
    expect(findings.some((x) => x.type === "duplicateIds" && x.column === "CSN")).toBe(false);
    expect(findings.some((x) => x.type === "duplicateIds" && x.column === "MRN")).toBe(false);
  });
  it("is review-only (not fixable) when no duplicate row is an exact copy", () => {
    const rows = [
      { CSN: "1", Ward: "ICU", Drug: "a", Visit_date: "2026-01-01", Note: "x" },
      { CSN: "1", Ward: "Peds", Drug: "b", Visit_date: "2026-01-02", Note: "y" },
      { CSN: "2", Ward: "ER", Drug: "c", Visit_date: "2026-01-03", Note: "z" },
      { CSN: "3", Ward: "ER", Drug: "d", Visit_date: "2026-01-04", Note: "w" },
    ];
    const f = checkupSheet(deriveSheet("S", rows)).find((x) => x.type === "duplicateEncounterIds");
    expect(f).toBeTruthy();
    expect(f.fixable).toBe(false);
    expect(f.exactCopyCount).toBe(0);
  });
  it("stays silent when every encounter ID is unique", () => {
    const rows = [
      { CSN: "1", Ward: "ICU", Drug: "a", Visit_date: "2026-01-01", Note: "x" },
      { CSN: "2", Ward: "Peds", Drug: "b", Visit_date: "2026-01-02", Note: "y" },
      { CSN: "3", Ward: "ER", Drug: "c", Visit_date: "2026-01-03", Note: "z" },
      { CSN: "4", Ward: "ER", Drug: "d", Visit_date: "2026-01-04", Note: "w" },
    ];
    const findings = checkupSheet(deriveSheet("S", rows));
    expect(findings.some((x) => x.type === "duplicateEncounterIds")).toBe(false);
  });
});

describe("scan — (c) duplicate MRNs", () => {
  it("explains repeats as often legitimate and offers an optional collapse", () => {
    const findings = checkupSheet(patientSheet());
    const f = findings.find((x) => x.type === "duplicatePatientIds");
    expect(f).toBeTruthy();
    expect(f.column).toBe("MRN");
    expect(f.detail).toMatch(/legitimate|multiple visits/i);
    expect(f.fixable).toBe(true);
    expect(f.fix.normalizer).toBe("keepOnePerPatient");
    expect(f.fix.needsPolicy).toBe(true);
    const values = f.fix.policyOptions.map((o) => o.value);
    expect(values).toContain("first::Visit_date");
    expect(values).toContain("last::Visit_date");
    expect(values).toContain("complete");
  });
  it("offers sheet-order choices when there is no date column", () => {
    const rows = [
      { MRN: "M1", Ward: "ICU", Note: "a" },
      { MRN: "M1", Ward: "Peds", Note: "b" },
      { MRN: "M2", Ward: "ER", Note: "c" },
      { MRN: "M3", Ward: "ER", Note: "d" },
    ];
    const f = checkupSheet(deriveSheet("S", rows)).find((x) => x.type === "duplicatePatientIds");
    expect(f).toBeTruthy();
    const values = f.fix.policyOptions.map((o) => o.value);
    expect(values).toContain("firstrow");
    expect(values).toContain("lastrow");
    expect(values).toContain("complete");
  });
  it("stays silent when every MRN is unique", () => {
    const rows = [
      { MRN: "M1", Ward: "ICU", Note: "a" },
      { MRN: "M2", Ward: "Peds", Note: "b" },
      { MRN: "M3", Ward: "ER", Note: "c" },
      { MRN: "M4", Ward: "ER", Note: "d" },
    ];
    const findings = checkupSheet(deriveSheet("S", rows));
    expect(findings.some((x) => x.type === "duplicatePatientIds")).toBe(false);
  });
});

describe("dedupeEncounterRows (pure)", () => {
  const headerNames = ["CSN", "MRN", "Visit_date", "Ward", "Drug"];
  it("removes only exact copies within a duplicated non-blank ID", () => {
    const sheet = encounterSheet();
    const out = dedupeEncounterRows(sheet.rows, headerNames, "CSN");
    expect(out.length).toBe(4); // only the exact copy of CSN 1001 goes
    expect(out.filter((r) => r.CSN === "1001").length).toBe(1);
    expect(out.filter((r) => r.CSN === "1003").length).toBe(2); // differing rows both kept
  });
  it("keeps exact-copy rows whose ID is blank", () => {
    const rows = [
      { CSN: null, Ward: "ICU" },
      { CSN: null, Ward: "ICU" }, // exact copy but no ID — left for review
      { CSN: "9", Ward: "ER" },
    ];
    const out = dedupeEncounterRows(rows, ["CSN", "Ward"], "CSN");
    expect(out.length).toBe(3);
  });
});

describe("keepOneRowPerPatient (pure)", () => {
  const sheet = patientSheet();
  const names = ["MRN", "Visit_date", "Ward", "Note"];
  it("keeps the latest visit per patient (last::date)", () => {
    const out = keepOneRowPerPatient(sheet.rows, "MRN", "last::Visit_date", names);
    expect(out.length).toBe(4);
    expect(out.find((r) => r.MRN === "M1").Ward).toBe("Peds"); // 2026-02-01
    expect(out.find((r) => r.MRN === "M3").Ward).toBe("ICU"); // blank date loses to a real one
    expect(out.some((r) => r.MRN == null)).toBe(true); // blank-MRN row never dropped
  });
  it("keeps the earliest visit per patient (first::date)", () => {
    const out = keepOneRowPerPatient(sheet.rows, "MRN", "first::Visit_date", names);
    expect(out.find((r) => r.MRN === "M1").Ward).toBe("ICU"); // 2026-01-05
    expect(out.find((r) => r.MRN === "M3").Ward).toBe("ICU"); // only row with a real date
  });
  it("keeps the most complete row per patient (complete)", () => {
    const out = keepOneRowPerPatient(sheet.rows, "MRN", "complete", names);
    expect(out.find((r) => r.MRN === "M1").Note).toBe("a"); // 4 filled cells beats 3
    expect(out.find((r) => r.MRN === "M3").Note).toBe("d");
  });
  it("keeps the first row in sheet order when asked (firstrow)", () => {
    const out = keepOneRowPerPatient(sheet.rows, "MRN", "firstrow", names);
    expect(out.find((r) => r.MRN === "M1").Ward).toBe("ICU");
    expect(out.length).toBe(4);
  });
});

describe("buildFixPlan — (d) all three surfaces", () => {
  it("dedupeEncounters: transform, Excel step, R script, and removed rows all agree", () => {
    const sheet = encounterSheet();
    const fixes = [{ normalizer: "dedupeEncounters", column: "CSN", params: {} }];
    const { plan, log, removedRows } = buildFixPlan(sheet, fixes);
    const rows = runPlan(plan, sheet);
    expect(rows.length).toBe(4);
    const entry = log.find((l) => l.rowsRemoved != null);
    expect(entry.rowsRemoved).toBe(1);
    expect(removedRows.length).toBe(1);
    expect(removedRows[0].CSN).toBe("1001");
    expect(plan.excel_steps.some((s) => /Remove Duplicates/i.test(s.instruction))).toBe(true);
    expect(plan.r_script).toMatch(/duplicated\(/);
  });
  it("keepOnePerPatient: transform, Excel step, R script, and removed rows all agree", () => {
    const sheet = patientSheet();
    const fixes = [{ normalizer: "keepOnePerPatient", column: "MRN", params: { policy: "last::Visit_date" } }];
    const { plan, log, removedRows } = buildFixPlan(sheet, fixes);
    const rows = runPlan(plan, sheet);
    expect(rows.length).toBe(4);
    expect(rows.find((r) => r.MRN === "M1").Ward).toBe("Peds");
    const entry = log.find((l) => l.rowsRemoved != null);
    expect(entry.rowsRemoved).toBe(2);
    expect(removedRows.length).toBe(2);
    expect(plan.excel_steps.some((s) => /Remove Duplicates/i.test(s.instruction))).toBe(true);
    expect(plan.excel_steps.some((s) => /sort/i.test(s.instruction))).toBe(true);
    expect(plan.r_script).toMatch(/MRN/);
  });
});

describe("replay — recorded dedupe steps run on next month's file", () => {
  it("replays dedupeEncounters with fuzzy column matching", () => {
    const recipe = addStep(newRecipe("test"), checkupStep({ normalizer: "dedupeEncounters", column: "CSN", params: {} }));
    const sheet = encounterSheet();
    const res = replayRecipe(recipe, sheet, null);
    expect(res.rows.length).toBe(4);
    expect(res.surprises.length).toBe(0);
  });
  it("replays keepOnePerPatient, re-matching both the ID and date columns", () => {
    const recipe = addStep(newRecipe("test"), checkupStep({ normalizer: "keepOnePerPatient", column: "mrn", params: { policy: "last::visit date" } }));
    const sheet = patientSheet(); // real headers: MRN, Visit_date
    const res = replayRecipe(recipe, sheet, null);
    expect(res.rows.length).toBe(4);
    expect(res.rows.find((r) => r.MRN === "M1").Ward).toBe("Peds");
    expect(res.surprises.length).toBe(0);
  });
  it("reports a surprise and skips when the ID column is gone", () => {
    const recipe = addStep(newRecipe("test"), checkupStep({ normalizer: "dedupeEncounters", column: "CSN", params: {} }));
    const sheet = deriveSheet("S", [{ Ward: "ICU" }, { Ward: "ICU" }]);
    const res = replayRecipe(recipe, sheet, null);
    expect(res.rows.length).toBe(2); // nothing changed
    expect(res.surprises.some((s) => s.type === "missingColumn")).toBe(true);
  });
});
