import { describe, it, expect } from "vitest";
import {
  newRecipe, addStep, checkupStep, deidentifyStep, reportCardsStep,
  matchColumn, columnKey, serializeRecipe, parseRecipe,
} from "./recipe.js";
import {
  newKeyStore, assignCodes, applyCodesToColumn, serializeKeyStore, parseKeyStore,
} from "./keyStore.js";
import { buildReportCards } from "./reportCards.js";
import { replayRecipe, formatReplayReport } from "./replay.js";
import { deriveSheet } from "../workbook.js";

// --- fixtures ---------------------------------------------------------------

// Month 1: a duplicate Smith row, an "amoxicillin"/"Amoxicillin" spelling split,
// clinics North (2 prescribers) and South (1 prescriber, a small cell).
function month1() {
  return deriveSheet("Prescriptions", [
    { Prescriber: "Dr. Smith", Drug: "Amoxicillin", Dose: "500", Clinic: "North" },
    { Prescriber: "Dr. Jones", Drug: "amoxicillin", Dose: "250", Clinic: "North" },
    { Prescriber: "Dr. Smith", Drug: "Amoxicillin", Dose: "500", Clinic: "North" }, // exact dup
    { Prescriber: "Dr. Lee", Drug: "Cephalexin", Dose: "500", Clinic: "South" },
  ]);
}

// Month 2: "Dose" renamed to "DoseAmount" (a real rename), a NEW spelling variant
// "AMOXICILLIN", and two NEW prescribers (Patel, Kim). Kim is alone in clinic West.
function month2() {
  return deriveSheet("Prescriptions", [
    { Prescriber: "Dr. Smith", Drug: "Amoxicillin", DoseAmount: "500", Clinic: "North" },
    { Prescriber: "Dr. Patel", Drug: "AMOXICILLIN", DoseAmount: "750", Clinic: "North" },
    { Prescriber: "Dr. Kim", Drug: "Cephalexin", DoseAmount: "500", Clinic: "West" },
    { Prescriber: "Dr. Jones", Drug: "amoxicillin", DoseAmount: "250", Clinic: "North" },
  ]);
}

// The recorded recipe: dedupe -> merge Drug spellings -> read Dose numbers ->
// swap names for codes -> report cards per prescriber, grouped by clinic.
function recordedRecipe() {
  let r = newRecipe("Monthly prescribing");
  r = addStep(r, checkupStep({ normalizer: "dedupeRows" }));
  r = addStep(r, checkupStep({ normalizer: "trimCase", column: "Drug", params: { map: { amoxicillin: "Amoxicillin" } } }));
  r = addStep(r, checkupStep({ normalizer: "coerceNumbers", column: "Dose" }));
  r = addStep(r, deidentifyStep("Prescriber"));
  r = addStep(r, reportCardsStep({ personColumn: "Prescriber", groupColumn: "Clinic" }));
  return r;
}

const REAL_NAMES = ["Dr. Smith", "Dr. Jones", "Dr. Lee", "Dr. Patel", "Dr. Kim"];

// --- small units ------------------------------------------------------------

describe("column fuzzy matching", () => {
  it("folds case, spaces, and punctuation", () => {
    expect(columnKey("Patient ID")).toBe(columnKey("patient_id"));
    expect(columnKey("Patient ID")).toBe("patientid");
  });
  it("matches a shifted/re-spaced header but not a true rename", () => {
    const headers = [{ name: "Prescriber Name" }, { name: "Drug" }];
    expect(matchColumn("prescriber name", headers)).toBe("Prescriber Name");
    expect(matchColumn("Dose", headers)).toBe(null);
  });
});

describe("key store assigns stable, padded codes", () => {
  it("gives new names the next code and keeps known ones", () => {
    const s0 = newKeyStore("Prescriber");
    const a = assignCodes(s0, ["Dr. Smith", "Dr. Jones", "Dr. Smith"]);
    expect(a.assignments["Dr. Smith"]).toBe("Prescriber 01");
    expect(a.assignments["Dr. Jones"]).toBe("Prescriber 02");
    expect(a.newlyAdded).toHaveLength(2);
    const b = assignCodes(a.store, ["Dr. Jones", "Dr. Lee"]);
    expect(b.assignments["Dr. Jones"]).toBe("Prescriber 02"); // stable
    expect(b.assignments["Dr. Lee"]).toBe("Prescriber 03");
    expect(b.newlyAdded).toHaveLength(1);
  });
  it("does not mutate the input store", () => {
    const s0 = newKeyStore();
    assignCodes(s0, ["A"]);
    expect(s0.codes).toEqual({});
    expect(s0.next).toBe(1);
  });
});

describe("report cards never expose names and flag small cells", () => {
  it("works on the already-coded table and warns on a group of one", () => {
    const rows = [
      { Prescriber: "Prescriber 01", Clinic: "North" },
      { Prescriber: "Prescriber 02", Clinic: "North" },
      { Prescriber: "Prescriber 03", Clinic: "West" },
    ];
    const rc = buildReportCards(rows, { personColumn: "Prescriber", groupColumn: "Clinic" });
    const blob = JSON.stringify(rc);
    for (const n of REAL_NAMES) expect(blob).not.toContain(n);
    expect(rc.warnings.some((w) => /West/.test(w.message))).toBe(true);
    const card = rc.cards.find((c) => c.subject === "Prescriber 01");
    expect(card.bars.find((b) => b.isSubject).label).toBe("Prescriber 01");
  });
});

// --- the scenario 2 acceptance ---------------------------------------------

describe("scenario 2: record on month 1, replay on month 2", () => {
  const recipe = recordedRecipe();

  it("round-trips the recipe through a file", () => {
    const parsed = parseRecipe(serializeRecipe(recipe));
    expect(parsed.steps).toHaveLength(5);
    expect(parsed.steps[4].type).toBe("reportCards");
  });

  // Month 1 establishes the key store.
  const run1 = replayRecipe(recipe, month1(), null);

  it("month 1 dedupes and assigns the first three codes", () => {
    // 4 rows -> 3 after removing the duplicate Smith row.
    const dedupe = run1.steps[0];
    expect(dedupe.rowsBefore).toBe(4);
    expect(dedupe.rowsAfter).toBe(3);
    expect(run1.keyStore.codes["Dr. Smith"]).toBe("Prescriber 01");
    expect(run1.keyStore.codes["Dr. Lee"]).toBe("Prescriber 03");
  });

  // Month 2 replays with the store from month 1.
  const run2 = replayRecipe(recipe, month2(), run1.keyStore);
  const types = run2.surprises.map((s) => s.type);

  it("announces the renamed column", () => {
    const miss = run2.surprises.find((s) => s.type === "missingColumn");
    expect(miss).toBeTruthy();
    expect(miss.column).toBe("Dose");
  });

  it("announces the new spelling variant, without merging it silently", () => {
    const variant = run2.surprises.find((s) => s.type === "newCategoryVariant");
    expect(variant).toBeTruthy();
    expect(variant.variants).toEqual(expect.arrayContaining(["Amoxicillin", "AMOXICILLIN"]));
  });

  it("announces the two new prescribers and gives them new stable codes", () => {
    const np = run2.surprises.find((s) => s.type === "newPeople");
    expect(np.people.map((p) => p.name)).toEqual(["Dr. Patel", "Dr. Kim"]);
    expect(run2.keyStore.codes["Dr. Patel"]).toBe("Prescriber 04");
    expect(run2.keyStore.codes["Dr. Kim"]).toBe("Prescriber 05");
    // Existing codes stayed put across the month boundary.
    expect(run2.keyStore.codes["Dr. Smith"]).toBe("Prescriber 01");
    expect(run2.keyStore.codes["Dr. Jones"]).toBe("Prescriber 02");
  });

  it("flags the small cell (clinic West has one person)", () => {
    expect(types).toContain("smallCell");
  });

  it("all three required surprises are present", () => {
    expect(types).toContain("missingColumn");
    expect(types).toContain("newCategoryVariant");
    expect(types).toContain("newPeople");
  });

  it("no report output contains a real name", () => {
    const blob = JSON.stringify(run2.reportCards);
    for (const n of REAL_NAMES) expect(blob).not.toContain(n);
    // The rows handed onward are coded too.
    const rowsBlob = JSON.stringify(run2.rows);
    for (const n of REAL_NAMES) expect(rowsBlob).not.toContain(n);
  });

  it("writes a plain-English replay report naming every surprise", () => {
    const text = formatReplayReport(recipe, run2, "month2.xlsx");
    expect(text).toMatch(/Surprises that need your attention/);
    expect(text).toMatch(/Dose/);
    expect(text).toMatch(/AMOXICILLIN/);
    expect(text).toMatch(/Prescriber 04/);
  });
});

describe("key store file round-trip keeps codes stable", () => {
  it("re-reads the same mapping", () => {
    const s0 = newKeyStore("Prescriber");
    const { store } = applyCodesToColumn(s0, [{ p: "Dr. A" }, { p: "Dr. B" }], "p");
    const back = parseKeyStore(serializeKeyStore(store));
    expect(back.codes).toEqual(store.codes);
    expect(back.next).toBe(store.next);
  });
});
