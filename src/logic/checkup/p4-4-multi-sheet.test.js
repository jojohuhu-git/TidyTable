import { describe, it, expect } from "vitest";
import { checkupSheet, checkupWorkbook } from "./scan.js";
import { deriveSheet } from "../workbook.js";

// P4-4: her workbooks are multi-tab. The scan used to only ever see
// workbook.sheets[0]; checkupWorkbook must scan every sheet and return one
// combined list, each finding labeled with the sheet it came from.
function encounters() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Sex: "M" },
    { PatientID: "P2", Sex: "Male" },
    { PatientID: "P3", Sex: "male" },
  ]);
}
function roster() {
  return deriveSheet("Roster", [
    { StaffID: "S1", Dose: "$1,200" },
    { StaffID: "S2", Dose: "250" },
  ]);
}

describe("P4-4 — checkupWorkbook scans every sheet, not just the first", () => {
  it("combines findings from all sheets, each labeled with its sheet name", () => {
    const findings = checkupWorkbook([encounters(), roster()]);
    const sheetNames = new Set(findings.map((f) => f.sheet));
    expect(sheetNames).toEqual(new Set(["Encounters", "Roster"]));

    const sexFinding = findings.find((f) => f.type === "categoryVariants" && f.column === "Sex");
    expect(sexFinding.sheet).toBe("Encounters");
    const doseFinding = findings.find((f) => f.type === "textNumbers" && f.column === "Dose");
    expect(doseFinding.sheet).toBe("Roster");
  });

  it("gives every finding a globally unique id across sheets (no collisions)", () => {
    // Both sheets independently produce an "f1" from checkupSheet's own
    // per-call counter reset — checkupWorkbook must not let those collide.
    const findings = checkupWorkbook([encounters(), roster()]);
    const ids = findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches what checkupSheet finds per sheet — no findings gained or lost", () => {
    const combined = checkupWorkbook([encounters(), roster()]);
    const soloEncounters = checkupSheet(encounters());
    const soloRoster = checkupSheet(roster());
    expect(combined.length).toBe(soloEncounters.length + soloRoster.length);
  });

  it("an empty sheets array yields no findings", () => {
    expect(checkupWorkbook([])).toEqual([]);
  });
});
