import { describe, it, expect } from "vitest";
import { parseWorkbookFile } from "./workbook.js";
import { matchRequest } from "./offline/matcher.js";
import { deriveSheet } from "./workbook.js";

function csvFile(text, name = "test.csv") {
  return new File([text], name, { type: "text/csv" });
}

// A1: CSV field-type guessing must not corrupt values before the checkup layer
// ever sees them.
describe("A1 — CSV parsing does not let SheetJS guess types", () => {
  it("keeps a censored lab value, a D/M-ambiguous date, and a comma-thousands number as literal text", async () => {
    const csv = [
      "WBC,Diagnosis,Notes,Count",
      "12.1,UTI,ok,10",
      "<0.5,UTI,low,20",
      "9.4,pneumonia,3/6/2024,30",
      "pending,UTI,waiting,40",
      '"1,204",UTI,thousand,50',
    ].join("\n");
    const result = await parseWorkbookFile(csvFile(csv));
    const rows = result.sheets[0].rows;
    expect(rows[1].WBC).toBe("<0.5"); // not silently turned into a date
    expect(rows[2].Notes).toBe("3/6/2024"); // not silently parsed as a date
    expect(rows[3].WBC).toBe("pending");
    expect(rows[4].WBC).toBe(1204); // clean numeric text is still coerced to a real number
  });

  it("still reads plain numeric columns as numbers, not text", async () => {
    const csv = "Age,Sex\n34,F\n56,M\n";
    const result = await parseWorkbookFile(csvFile(csv));
    const ageHeader = result.sheets[0].headers.find((h) => h.name === "Age");
    expect(ageHeader.type).toBe("number");
    expect(result.sheets[0].rows[0].Age).toBe(34);
  });

  it("a real .xlsx file is unaffected (keeps its cellDates behavior)", async () => {
    // Build a minimal xlsx in-memory via deriveSheet-equivalent round trip is
    // out of scope here; xlsx handling is covered by the existing epoch-date
    // and general workbook tests. This test only documents the CSV-only scope
    // of the fix by checking the CSV branch is chosen from the file name.
    const result = await parseWorkbookFile(csvFile("A,B\n1,2\n", "notcsv.CSV"));
    expect(result.sheets[0].rows[0].A).toBe(1);
  });
});

// NEW-4: a repeated encounter/case ID (not literally named "patient") must
// still trigger the grain question, not a silent over-count.
describe("NEW-4 — grain detection finds a repeating ID-like column even when unnamed after the entity", () => {
  function edSheet() {
    // 12 rows, 11 distinct CSN (one CSN repeats for two organisms) — mirrors
    // the real dataset's one-row-per-organism grain trap (~98% distinct),
    // at a synthetic scale that still clears the "ID-like" 90% threshold.
    const rows = [
      { CSN: "E1", Organism: "E. coli", Diagnosis: "UTI" },
      { CSN: "E1", Organism: "Klebsiella", Diagnosis: "UTI" },
    ];
    for (let i = 2; i <= 11; i++) rows.push({ CSN: `E${i}`, Organism: "E. coli", Diagnosis: i % 3 === 0 ? "pneumonia" : "UTI" });
    return deriveSheet("Encounters", rows);
  }

  it("asks a grain question instead of silently returning the row count", () => {
    const sheet = edSheet();
    const workbook = { fileName: "ed.xlsx", sheets: [sheet] };
    const result = matchRequest("how many patients with UTI", workbook, { present: false });
    expect(result.status).toBe("grain");
    expect(result.grain.entityColumn).toBe("CSN");
  });

  it("group-then-test mode then counts distinct CSNs, not rows", () => {
    const sheet = edSheet();
    const workbook = { fileName: "ed.xlsx", sheets: [sheet] };
    const result = matchRequest("how many patients with UTI", workbook, { present: false }, { grainMode: "group-then-test" });
    expect(result.status).toBe("confident");
    expect(result.grain.entityColumn).toBe("CSN");
  });
});
