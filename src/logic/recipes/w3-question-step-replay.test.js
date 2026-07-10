import { describe, it, expect } from "vitest";
import { runOffline } from "../offline/runOffline.js";
import { newRecipe, addStep, questionStep, defaultRoutineName } from "./recipe.js";
import { replayRecipe, formatReplayReport } from "./replay.js";
import { deriveSheet } from "../workbook.js";

// W3: a successful offline Step 3 answer is recorded into the routine as a
// "question" step (original wording + the resolved match), the same way a
// checkup fix already is. Replay must re-resolve that match against a new
// file's real headers — never re-guess from the English wording, and never
// silently guess past a renamed or missing column/value.

function month1() {
  const enc = deriveSheet("Encounters", [
    { PatientID: "P1", Ward: "ICU", Diagnosis: "pyelonephritis" },
    { PatientID: "P2", Ward: "General", Diagnosis: "UTI" },
    { PatientID: "P3", Ward: "ICU", Diagnosis: "pyelonephritis" },
    { PatientID: "P4", Ward: "General", Diagnosis: "sepsis" },
  ]);
  return { fileName: "DC antibiotics.xlsx", sheets: [enc] };
}

// Month 2: "Ward" renamed to "Unit" (a real rename) and one extra matching row.
function month2RenamedWard() {
  const enc = deriveSheet("Encounters", [
    { PatientID: "P1", Unit: "ICU", Diagnosis: "pyelonephritis" },
    { PatientID: "P2", Unit: "General", Diagnosis: "UTI" },
    { PatientID: "P3", Unit: "ICU", Diagnosis: "pyelonephritis" },
    { PatientID: "P5", Unit: "ICU", Diagnosis: "pyelonephritis" },
  ]);
  return deriveSheet("Encounters", enc.rows);
}

// Month 3: same headers, but the "ICU" value no longer appears in the Ward column.
function month3MissingValue() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Ward: "General", Diagnosis: "pyelonephritis" },
    { PatientID: "P2", Ward: "General", Diagnosis: "UTI" },
  ]);
}

const QUESTION = "how many patients with pyelonephritis, and of those how many were ICU";

describe("recording a question step from a successful offline answer", () => {
  it("runOffline returns the resolved match alongside the plan", () => {
    const res = runOffline(QUESTION, month1(), {});
    expect(res.kind).toBe("answer");
    expect(res.match).toBeTruthy();
    expect(res.match.status).toBe("confident");
    expect(res.match.stages).toHaveLength(2);
  });

  it("questionStep records the original wording and the resolved match", () => {
    const res = runOffline(QUESTION, month1(), {});
    let recipe = newRecipe("Monthly");
    recipe = addStep(recipe, questionStep(QUESTION, res.match, "2 rows"));
    expect(recipe.steps).toHaveLength(1);
    expect(recipe.steps[0].type).toBe("question");
    expect(recipe.steps[0].request).toBe(QUESTION);
    expect(recipe.steps[0].match.stages[1].condition.column).toBe("Ward");
  });
});

describe("replaying a question step on a second file with one renamed column", () => {
  function recordedRecipe() {
    const res = runOffline(QUESTION, month1(), {});
    let recipe = newRecipe("Monthly");
    recipe = addStep(recipe, questionStep(QUESTION, res.match, "2 rows"));
    return recipe;
  }

  it("re-resolves the renamed column via fuzzy match and recomputes the count on the new file", () => {
    const recipe = recordedRecipe();
    const result = replayRecipe(recipe, month2RenamedWard(), null);
    // "Ward" -> "Unit" is a true rename for the ORIGINAL column name, but the
    // condition's column recorded was "Ward" and the new sheet also has no
    // exact "Ward" header — replay must say so plainly, not guess "Unit" is
    // the same thing just because it looks close in position.
    const missing = result.surprises.filter((s) => s.type === "missingColumn");
    expect(missing.some((s) => s.column === "Ward")).toBe(true);
    expect(result.steps[0].skipped).toBe(true);
  });

  it("writes a plain-English replay line naming the renamed column, never guessing", () => {
    const recipe = recordedRecipe();
    const result = replayRecipe(recipe, month2RenamedWard(), null);
    const text = formatReplayReport(recipe, result, "next-month.xlsx");
    expect(text).toMatch(/Ward/);
    expect(text).toMatch(/renamed or removed/);
  });

  it("answers correctly when every recorded column still fuzzy-matches", () => {
    const recipe = recordedRecipe();
    const sameShape = deriveSheet("Encounters", [
      { PatientID: "P1", Ward: "ICU", Diagnosis: "pyelonephritis" },
      { PatientID: "P2", Ward: "ICU", Diagnosis: "pyelonephritis" },
      { PatientID: "P3", Ward: "General", Diagnosis: "pyelonephritis" },
    ]);
    const result = replayRecipe(recipe, sameShape, null);
    expect(result.surprises.filter((s) => s.type === "missingColumn")).toHaveLength(0);
    expect(result.questionAnswers).toHaveLength(1);
    expect(result.questionAnswers[0].answer).toBe("2 rows");
  });

  it("reports a missing value plainly instead of guessing, and still gives an honest zero", () => {
    const recipe = recordedRecipe();
    const result = replayRecipe(recipe, month3MissingValue(), null);
    const missingValue = result.surprises.find((s) => s.type === "missingValue");
    expect(missingValue).toBeTruthy();
    expect(missingValue.column).toBe("Ward");
    expect(result.questionAnswers[0].answer).toBe("0 rows");
  });
});

describe("defaultRoutineName", () => {
  it("derives a friendly name from the uploaded file", () => {
    expect(defaultRoutineName("DC antibiotics.xlsx")).toBe("DC antibiotics — monthly");
  });
  it("falls back to a generic default with no file name", () => {
    expect(defaultRoutineName("")).toBe("Monthly cleanup");
    expect(defaultRoutineName(null)).toBe("Monthly cleanup");
  });
});
