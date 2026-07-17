import { describe, it, expect } from "vitest";
import { matchRequest } from "./matcher.js";
import { detectIntent, detectTopN } from "./synonyms.js";
import { deriveSheet } from "../workbook.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";
import { fileSignature } from "./aliasStore.js";
import { planShapeFromMatch, planShapeFromAiPlan, stripValues } from "./planShape.js";
import { rememberGraduation, graduationFor, applyGraduation, emptyGraduationStore } from "./graduationStore.js";

// Phase 6 — the AI-graduation logic (value-free plan shapes + offline replay).
// Pure functions, no localStorage, so this is the node-env logic layer; the
// happy-dom store round-trip + end-to-end runOffline sits in
// test/phase6-stores.dom.test.jsx.

const wb = () => buildExampleWorkbook();
const shapeHelpers = { detectIntent, detectTopN };

describe("planShapeFromMatch — value-free shape of a confident offline match", () => {
  it("captures an aggregation's intent, target and sheet, with no filters", () => {
    const m = matchRequest("average duration_days", wb(), {}, {});
    expect(m.status).toBe("confident");
    const shape = planShapeFromMatch(m);
    expect(shape).toMatchObject({ intent: "average", target: "Duration_days", group: null, filters: [] });
    expect(shape.columns).toContain("Duration_days");
  });

  it("keeps a filter's COLUMN and operator but NEVER its cell value", () => {
    const m = matchRequest("average duration_days for patients with UTI", wb(), {}, {});
    expect(m.status).toBe("confident");
    const shape = planShapeFromMatch(m);
    // The filter shape names the column and the operator...
    expect(shape.filters).toEqual([{ column: "Diagnosis", kind: "value", op: "=" }]);
    // ...but the actual value "UTI" appears nowhere in the persisted shape.
    expect(JSON.stringify(shape)).not.toContain("UTI");
  });

  it("captures a top-N ranking's column and family, value-free", () => {
    const m = matchRequest("most common diagnosis", wb(), {}, {});
    expect(m.status).toBe("confident");
    const shape = planShapeFromMatch(m);
    expect(shape.intent).toBe("topN");
    expect(shape.topN).toMatchObject({ column: "Diagnosis", family: "frequency" });
  });

  it("returns null for a non-confident match", () => {
    const m = matchRequest("average treatment window", wb(), {}, {});
    expect(m.status).toBe("none");
    expect(planShapeFromMatch(m)).toBeNull();
  });
});

describe("stripValues — the enforced privacy chokepoint", () => {
  it("drops every value-bearing key at any depth", () => {
    const dirty = {
      intent: "average", target: "Duration_days",
      filters: [{ column: "Drug", op: "=", value: "amoxicillin", term: "amoxicillin" }],
      nested: { values: ["UTI", "pneumonia"], when: { column: "X", value: "y" } },
    };
    const clean = stripValues(dirty);
    const dump = JSON.stringify(clean);
    for (const secret of ["amoxicillin", "UTI", "pneumonia"]) expect(dump).not.toContain(secret);
    expect(clean.filters[0]).toEqual({ column: "Drug", op: "=" });
    expect(dump).toContain("Drug"); // column names are schema, kept
  });
});

describe("planShapeFromAiPlan — coarse, names-only shape from a Claude answer", () => {
  it("takes the intent from wording and the columns named in the plan text — no values", () => {
    const headers = wb().sheets[0].headers;
    const plan = {
      summary: "Average of Duration_days across all rows.",
      transform_code: "var nums = rows.map(function(r){return r['Duration_days'];}); return nums;",
      excel_steps: [{ title: "Average", instruction: "=AVERAGE over Duration_days" }],
    };
    const shape = planShapeFromAiPlan({ request: "how long on average were folks kept on their meds", plan, headers, ...shapeHelpers });
    expect(shape.intent).toBe("average");
    expect(shape.columns).toEqual(["Duration_days"]);
    expect(shape.fromAi).toBe(true);
  });
});

describe("applyGraduation — reconstruct an offline answer from a remembered shape", () => {
  const sig = () => fileSignature(wb().sheets[0].headers);

  it("auto-answers a filter-free AI shape by resolving the sole numeric column", () => {
    const headers = wb().sheets[0].headers;
    const plan = { summary: "Average of Duration_days.", transform_code: "r['Duration_days']", excel_steps: [] };
    const shape = planShapeFromAiPlan({ request: "average treatment window", plan, headers, ...shapeHelpers });
    let store = emptyGraduationStore();
    store = rememberGraduation(store, sig(), "average treatment window", shape);

    const grad = applyGraduation(store, "average treatment window", wb());
    expect(grad.status).toBe("confident");
    expect(grad.intent).toBe("average");
    expect(grad.aggregation.targetColumn).toBe("Duration_days");
    expect(grad.graduated).toBe(true);
  });

  it("does NOT auto-answer a filtered shape (its values would have to be re-guessed)", () => {
    const m = matchRequest("average duration_days for patients with UTI", wb(), {}, {});
    const shape = planShapeFromMatch(m);
    let store = rememberGraduation(emptyGraduationStore(), sig(), "avg dur for uti folks", shape);
    expect(graduationFor(store, sig(), "avg dur for uti folks")).toBeTruthy();
    expect(applyGraduation(store, "avg dur for uti folks", wb())).toBeNull();
  });

  it("does NOT auto-answer when the sole-numeric-column heuristic is ambiguous", () => {
    // A file with TWO genuinely numeric columns; a plan naming both → ambiguous
    // target → honest silence (protects the 0-confident-wrong guarantee).
    const twoNumWb = () => ({
      fileName: "x",
      sheets: [deriveSheet("S", [
        { PatientID: "P1", Duration_days: 10, Cost: 100 },
        { PatientID: "P2", Duration_days: 7, Cost: 250 },
      ])],
    });
    const headers = twoNumWb().sheets[0].headers;
    const sig2 = fileSignature(headers);
    const plan = { summary: "Duration_days and Cost.", transform_code: "r['Duration_days']+r['Cost']", excel_steps: [] };
    const shape = planShapeFromAiPlan({ request: "average treatment window", plan, headers, ...shapeHelpers });
    const store = rememberGraduation(emptyGraduationStore(), sig2, "average treatment window", shape);
    expect(applyGraduation(store, "average treatment window", twoNumWb())).toBeNull();
  });

  it("reconstructs a top-N ranking shape", () => {
    const m = matchRequest("most common diagnosis", wb(), {}, {});
    const shape = planShapeFromMatch(m);
    const store = rememberGraduation(emptyGraduationStore(), sig(), "which condition shows up the most", shape);
    const grad = applyGraduation(store, "which condition shows up the most", wb());
    expect(grad.intent).toBe("topN");
    expect(grad.topN.targetColumn).toBe("Diagnosis");
  });

  it("a genuinely different file shape does not apply another file's graduation (P4-1: near-match only)", () => {
    const m = matchRequest("average duration_days", wb(), {}, {});
    const shape = planShapeFromMatch(m);
    const store = rememberGraduation(emptyGraduationStore(), "some|other|signature", "average treatment window", shape);
    expect(applyGraduation(store, "average treatment window", wb())).toBeNull();
  });

  it("P4-1: a near-match file shape (one unrelated column renamed) still auto-answers", () => {
    const plan = { summary: "Average of Duration_days.", transform_code: "r['Duration_days']", excel_steps: [] };
    const shape = planShapeFromAiPlan({ request: "average treatment window", plan, headers: wb().sheets[0].headers, ...shapeHelpers });
    const store = rememberGraduation(emptyGraduationStore(), sig(), "average treatment window", shape);

    // Next month's export renames an unrelated column; Duration_days is untouched.
    const nextMonth = {
      fileName: "x",
      sheets: [deriveSheet("S", [
        { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, Visit_time: "2026-01-01", Lab_value: 5 },
        { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 7, Visit_time: "2026-01-02", Lab_value: 6 },
      ])], // Visit_date renamed to Visit_time — everything else the same shape
    };
    const grad = applyGraduation(store, "average treatment window", nextMonth);
    expect(grad.status).toBe("confident");
    expect(grad.aggregation.targetColumn).toBe("Duration_days");
  });

  it("P4-1: does not guess when the near-match shape's own target column is gone too", () => {
    const plan = { summary: "Average of Duration_days.", transform_code: "r['Duration_days']", excel_steps: [] };
    const shape = planShapeFromAiPlan({ request: "average treatment window", plan, headers: wb().sheets[0].headers, ...shapeHelpers });
    const store = rememberGraduation(emptyGraduationStore(), sig(), "average treatment window", shape);

    // Duration_days itself was renamed — the shape's target no longer exists.
    const renamedTarget = {
      fileName: "x",
      sheets: [deriveSheet("S", [
        { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Length_of_stay: 10, Visit_date: "2026-01-01", Lab_value: 5 },
        { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Length_of_stay: 7, Visit_date: "2026-01-02", Lab_value: 6 },
      ])],
    };
    expect(applyGraduation(store, "average treatment window", renamedTarget)).toBeNull();
  });
});
