import { describe, it, expect } from "vitest";
import { matchRequest } from "./matcher.js";
import { runOffline } from "./runOffline.js";
import { deriveSheet } from "../workbook.js";
import { scoreTokenMatch, findValueCandidates, findColumnCandidates, nearestSuggestions } from "./valueMatch.js";

// W2: the smarter offline matcher. The owner's real failure was
// "number of patients with E. Coli in urine" not finding ESCHERICHIA COLI
// under a "Urine Organisms" column — this file's first describe block is
// that exact regression, then each sub-part (W2a-W2e) gets its own coverage.

function dcAntibioticsBook() {
  const enc = deriveSheet("Encounters", [
    { PatientID: "P1", "Urine Organisms": "ESCHERICHIA COLI", Ward: "ICU" },
    { PatientID: "P2", "Urine Organisms": "KLEBSIELLA PNEUMONIAE", Ward: "General" },
    { PatientID: "P3", "Urine Organisms": "ESCHERICHIA COLI", Ward: "General" },
    { PatientID: "P4", "Urine Organisms": "PSEUDOMONAS AERUGINOSA", Ward: "ICU" },
  ]);
  return { fileName: "DC antibiotics.xlsx", sheets: [enc] };
}

describe("W2 canonical regression — E. coli in urine answers offline", () => {
  it("matchRequest resolves 'number of patients with E. Coli in urine' to a stretch that needs confirming", () => {
    const result = matchRequest("number of patients with E. Coli in urine", dcAntibioticsBook(), { present: false });
    expect(result.status).toBe("needs_confirm");
    expect(result.candidates).toEqual([{ column: "Urine Organisms", value: "ESCHERICHIA COLI" }]);
  });

  it("runOffline surfaces it as a confirm-value decline, not a needs_definitions block", () => {
    const res = runOffline("number of patients with E. Coli in urine", dcAntibioticsBook(), {});
    expect(res.kind).toBe("confirm-value");
    expect(res.candidates[0].value).toBe("ESCHERICHIA COLI");
    expect(res.candidates[0].column).toBe("Urine Organisms");
  });

  it("once the alias is confirmed for the session, the same phrase answers immediately with the right count", () => {
    const aliasMap = new Map([["e coli", { column: "Urine Organisms", value: "ESCHERICHIA COLI" }]]);
    const result = matchRequest("number of patients with E. Coli in urine", dcAntibioticsBook(), { present: false }, { aliasMap });
    expect(result.status).toBe("confident");
    const res = runOffline("number of patients with E. Coli in urine", dcAntibioticsBook(), { aliasMap });
    expect(res.kind).toBe("answer");
    expect(res.exec.levels[res.exec.levels.length - 1].count).toBe(2); // P1, P3
  });
});

describe("W2a — token-subset value matching", () => {
  it.each([
    ["e coli", "ESCHERICHIA COLI"], // "e" is a prefix of "escherichia", "coli" is a whole word
    ["pseudomonas", "PSEUDOMONAS AERUGINOSA"], // one query word is a whole word in the value
  ])("findValueCandidates finds a prefix/subset match for %s -> %s", (query, expected) => {
    const cands = findValueCandidates(query, dcAntibioticsBook().sheets[0].headers, indexOf(dcAntibioticsBook()));
    expect(cands[0].value).toBe(expected);
  });

  it("scoreTokenMatch: exact token sets score highest, prefixes score lower, no-match returns null", () => {
    expect(scoreTokenMatch(["e", "coli"], ["escherichia", "coli"])).toBe(1); // prefix tier
    expect(scoreTokenMatch(["coli"], ["escherichia", "coli"])).toBe(2); // all-tokens-equal
    expect(scoreTokenMatch(["escherichia", "coli"], ["escherichia", "coli"])).toBe(3); // exact
    expect(scoreTokenMatch(["zzz"], ["escherichia", "coli"])).toBe(null);
  });

  it("a whole-phrase exact match still answers directly with no stretch", () => {
    const result = matchRequest("how many patients with KLEBSIELLA PNEUMONIAE", dcAntibioticsBook(), { present: false });
    expect(result.status).toBe("confident");
  });
});

describe("W2b — clinical abbreviation seeds", () => {
  it.each([
    ["mrsa", "STAPHYLOCOCCUS AUREUS"],
    ["staph", "STAPHYLOCOCCUS AUREUS"],
    ["c diff", "CLOSTRIDIOIDES DIFFICILE"],
    ["klebs", "KLEBSIELLA PNEUMONIAE"],
  ])("expands %s to find %s in the data", (abbrev, expectedValue) => {
    const enc = deriveSheet("Encounters", [
      { PatientID: "P1", Organism: "STAPHYLOCOCCUS AUREUS" },
      { PatientID: "P2", Organism: "CLOSTRIDIOIDES DIFFICILE" },
      { PatientID: "P3", Organism: "KLEBSIELLA PNEUMONIAE" },
    ]);
    const wb = { fileName: "m.xlsx", sheets: [enc] };
    const result = matchRequest(`how many patients with ${abbrev}`, wb, { present: false });
    expect(result.status).toBe("needs_confirm"); // an expansion always confirms
    expect(result.candidates.some((c) => c.value === expectedValue)).toBe(true);
  });

  it("an abbreviation expansion is always flagged as a stretch, never answered silently", () => {
    const enc = deriveSheet("Encounters", [{ PatientID: "P1", Organism: "STAPHYLOCOCCUS AUREUS" }]);
    const wb = { fileName: "m.xlsx", sheets: [enc] };
    const result = matchRequest("how many patients with staph", wb, { present: false });
    expect(result.status).toBe("needs_confirm");
  });
});

describe("W2c — column scoping ('in urine')", () => {
  it("scopes the value scan to the hinted column when it resolves to a real header", () => {
    const cols = findColumnCandidates("urine", dcAntibioticsBook().sheets[0].headers);
    expect(cols).toContain("Urine Organisms");
  });

  it("restricting to the scoped column picks the in-column value over a same-token match elsewhere", () => {
    // "amoxicillin" appears both as a Urine Organisms value (contrived, but
    // proves the point) and as a Drug value — scoping to "drug" must land on
    // the Drug column's value, not silently prefer whichever column happens
    // to be scanned first.
    const enc = deriveSheet("Encounters", [
      { PatientID: "P1", "Urine Organisms": "AMOXICILLIN RESISTANT ORGANISM", Drug: "amoxicillin" },
    ]);
    const wb = { fileName: "m.xlsx", sheets: [enc] };
    const result = matchRequest("how many patients with amoxicillin in drug", wb, { present: false });
    expect(result.status).toBe("confident");
    expect(result.stages[0].condition.column).toBe("Drug");
    expect(result.stages[0].condition.value).toBe("amoxicillin");
  });

  it("falls back to searching all columns when the hinted column has no match, and still finds the value", () => {
    const enc = deriveSheet("Encounters", [
      { PatientID: "P1", "Urine Organisms": "ESCHERICHIA COLI", Blood: "no growth" },
    ]);
    const wb = { fileName: "m.xlsx", sheets: [enc] };
    const result = matchRequest("how many patients with e coli in blood", wb, { present: false });
    expect(result.status).toBe("needs_confirm");
    expect(result.candidates[0].column).toBe("Urine Organisms");
  });
});

describe("W2d — middle-path confirmation", () => {
  it("an exact, unambiguous match never asks to confirm", () => {
    const result = matchRequest("how many patients with ESCHERICHIA COLI", dcAntibioticsBook(), { present: false });
    expect(result.status).toBe("confident");
  });

  it("a stretch (prefix/token-subset match) asks to confirm with the real cell value", () => {
    const result = matchRequest("how many patients with e coli", dcAntibioticsBook(), { present: false });
    expect(result.status).toBe("needs_confirm");
    expect(result.phrase).toBe("e coli");
    expect(result.candidates[0].value).toBe("ESCHERICHIA COLI");
  });

  it("once confirmed via the alias map, the same phrase never asks again in the same session", () => {
    const aliasMap = new Map([["e coli", { column: "Urine Organisms", value: "ESCHERICHIA COLI" }]]);
    const result = matchRequest("how many patients with e coli", dcAntibioticsBook(), { present: false }, { aliasMap });
    expect(result.status).toBe("confident");
  });
});

describe("W2e — helpful declines offer nearest suggestions", () => {
  it("nearestSuggestions ranks real values/columns by token overlap instead of leaving the user with nothing", () => {
    const wb = dcAntibioticsBook();
    const suggestions = nearestSuggestions("kleb", wb.sheets[0].headers, indexOf(wb));
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.kind === "value" && String(s.value).includes("KLEBSIELLA"))).toBe(true);
  });

  it("a genuinely unresolvable term declines with nearest suggestions attached to the missing term", () => {
    const result = matchRequest("how many patients with zzzznotarealvalue", dcAntibioticsBook(), { present: false });
    expect(result.status).toBe("needs_definitions");
    expect(result.missingTerms[0].nearest).toBeDefined();
  });

  it("runOffline carries the nearest suggestions through to the block result", () => {
    const res = runOffline("how many patients with zzzznotarealvalue", dcAntibioticsBook(), {});
    expect(res.kind).toBe("block");
    expect(Array.isArray(res.nearest)).toBe(true);
  });
});

// Rebuilds the same per-column value index the matcher uses internally, for
// unit-testing valueMatch.js functions directly against the fixture data.
function indexOf(workbook) {
  const sheet = workbook.sheets[0];
  const index = new Map();
  for (const h of sheet.headers) {
    const m = new Map();
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") continue;
      const k = String(v).trim().toLowerCase();
      if (!m.has(k)) m.set(k, v);
    }
    index.set(h.name, m);
  }
  return index;
}
