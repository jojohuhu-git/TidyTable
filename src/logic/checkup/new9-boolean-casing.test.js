import { describe, it, expect } from "vitest";
import { checkupSheet } from "./scan.js";
import { buildColumnProfile } from "../columnProfile.js";
import { deriveSheet } from "../workbook.js";

// NEW-9 (datasets-2026-07-09-realworld-examples.md): the ED-urine dataset
// spells yes/no both "Yes"/"No" (Admit, Cystitis Dx, Positive Culture) and
// "YES"/"NO" (Urinary Device Present, 0-14 Day ED Return, Pregnant) — a
// mix of casing conventions across columns. Within a single column that
// mixes casing, findCategoryVariants (case-folded) already merges them;
// this locks that in with the real Yes/YES value shapes, and checks B6's
// profile reports each column's real vocabulary honestly.
describe("NEW-9 — Yes/YES casing variants merge like any other category variant", () => {
  it("merges 'YES' into 'Yes' when a column mixes both castings", () => {
    const sheet = deriveSheet("D", [
      { PatientID: "P1", Admit: "Yes" }, { PatientID: "P2", Admit: "Yes" }, { PatientID: "P3", Admit: "YES" },
      { PatientID: "P4", Admit: "No" },
    ]);
    const findings = checkupSheet(sheet);
    const cv = findings.find((f) => f.type === "categoryVariants" && f.column === "Admit");
    expect(cv).toBeTruthy();
    expect(cv.fix.params.map).toEqual({ YES: "Yes" });
  });

  it("a column consistently spelled 'YES'/'NO' is not flagged as having variants (nothing to merge within it)", () => {
    const sheet = deriveSheet("D", [
      { PatientID: "P1", "Urinary Device Present": "YES" },
      { PatientID: "P2", "Urinary Device Present": "NO" },
      { PatientID: "P3", "Urinary Device Present": "YES" },
    ]);
    const findings = checkupSheet(sheet);
    expect(findings.find((f) => f.type === "categoryVariants" && f.column === "Urinary Device Present")).toBeUndefined();
  });

  it("B6's profile reports each column's real vocabulary as typed, without implying they differ semantically", () => {
    const sheet = deriveSheet("D", [
      { Admit: "Yes", "Urinary Device Present": "YES" },
      { Admit: "No", "Urinary Device Present": "NO" },
    ]);
    const profile = buildColumnProfile(sheet);
    const admit = profile.find((p) => p.name === "Admit");
    const device = profile.find((p) => p.name === "Urinary Device Present");
    expect(admit.summary).toMatch(/Yes/);
    expect(device.summary).toMatch(/YES/);
  });
});
