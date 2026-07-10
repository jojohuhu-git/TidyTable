// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { matchRequest } from "./matcher.js";
import { runOffline } from "./runOffline.js";
import { fillPlan } from "./fillPlan.js";
import { deriveSheet } from "../workbook.js";

// Phase 4 (2026-07-10): the most-common/top-N ranking family, across every
// output surface — plain-English summary, Excel steps, and the worker
// transform (executed here, same as phase2-fillplan.test.js, so the
// generated code is proven to reproduce the app's own numbers).

function book() {
  const enc = deriveSheet("Encounters", [
    { Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, PatientID: "P1" },
    { Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 6, PatientID: "P2" },
    { Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 5, PatientID: "P3" },
    { Diagnosis: "pneumonia", Drug: "cefpodoxime", Duration_days: "N/A", PatientID: "P4" },
    { Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, PatientID: "P5" },
  ]);
  return { fileName: "m.xlsx", sheets: [enc] };
}

function runTransformOf(plan, wb) {
  const sheets = { Encounters: wb.sheets[0].rows };
  // eslint-disable-next-line no-new-func
  return new Function("sheets", plan.transform_code)(sheets);
}

describe("Phase 4 — frequency ranking (most/least common, any column type)", () => {
  it("'most common diagnosis' ranks the full table, most common first, as n (%)", () => {
    const wb = book();
    const m = matchRequest("most common diagnosis", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.intent).toBe("topN");
    expect(m.topN).toEqual({ targetColumn: "Diagnosis", direction: "most", n: Infinity, family: "frequency" });
    const { plan, resultRows } = fillPlan(m, wb);
    // UTI and pneumonia are tied at 2; cystitis is 1. Sorted desc, no cap.
    expect(resultRows).toEqual([
      { Diagnosis: "UTI", Count: 2, "Share of total": "40%" },
      { Diagnosis: "pneumonia", Count: 2, "Share of total": "40%" },
      { Diagnosis: "cystitis", Count: 1, "Share of total": "20%" },
    ]);
    expect(plan.summary).toMatch(/most common first/);
    expect(runTransformOf(plan, wb)).toEqual(resultRows);
  });

  it("'least common diagnosis' reorders ascending", () => {
    const wb = book();
    const m = matchRequest("least common diagnosis", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.topN.direction).toBe("least");
    const { plan, resultRows } = fillPlan(m, wb);
    expect(resultRows[0]).toEqual({ Diagnosis: "cystitis", Count: 1, "Share of total": "20%" });
    expect(plan.summary).toMatch(/least common first/);
    expect(runTransformOf(plan, wb)).toEqual(resultRows);
  });

  it("'which drug was used most' / 'which drug was used least' resolve the same family", () => {
    const wb = book();
    const most = matchRequest("which drug was used most", wb, { present: false });
    expect(most.status).toBe("confident");
    expect(most.topN.targetColumn).toBe("Drug");
    expect(most.topN.direction).toBe("most");
    const least = matchRequest("which drug was used least", wb, { present: false });
    expect(least.status).toBe("confident");
    expect(least.topN.direction).toBe("least");
  });

  it("'top 5 drugs' caps the table at 5 (fewer than 5 distinct here, so all 3 show)", () => {
    const wb = book();
    const m = matchRequest("top 5 drugs", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.topN).toEqual({ targetColumn: "Drug", direction: "most", n: 5, family: "frequency" });
    const { resultRows } = fillPlan(m, wb);
    expect(resultRows).toHaveLength(3);
  });

  it("'top 2 drugs' caps the ranked table at 2", () => {
    const wb = book();
    const m = matchRequest("top 2 drugs", wb, { present: false });
    const { resultRows, plan } = fillPlan(m, wb);
    expect(resultRows).toHaveLength(2);
    expect(resultRows.map((r) => r.Drug)).toEqual(["cephalexin", "amoxicillin"]);
    expect(plan.summary).toMatch(/Showing 2 of 3 distinct values/);
  });

  it("'top five drugs' parses the number word the same as the digit", () => {
    const wb = book();
    const digit = matchRequest("top 5 drugs", wb, { present: false });
    const word = matchRequest("top five drugs", wb, { present: false });
    expect(word.topN.n).toBe(5);
    expect(word.topN).toEqual(digit.topN);
  });

  it("a tie sitting at the cutoff is shown in full, never arbitrarily split — 'top 1 drug'", () => {
    const wb = book();
    const m = matchRequest("top 1 drug", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.topN.n).toBe(1);
    const { resultRows, plan } = fillPlan(m, wb);
    // cephalexin and amoxicillin are tied at 2 — both show, not just one.
    expect(resultRows).toHaveLength(2);
    expect(plan.summary).toMatch(/extended to include a tie at the cutoff/);
  });

  it("works with a cohort filter: 'most common drug for patients with UTI'", () => {
    const wb = book();
    const m = matchRequest("most common drug for patients with UTI", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.stages).toHaveLength(1);
    const { resultRows } = fillPlan(m, wb);
    // Both UTI rows: cephalexin and amoxicillin, one each — tied, both show.
    expect(resultRows).toHaveLength(2);
    expect(resultRows.every((r) => r.Count === 1)).toBe(true);
  });

  it("blank/unreadable cells are excluded from the ranking, never surfaced as a winner, and the denominator is stated", () => {
    const enc = deriveSheet("Encounters", [
      { Diagnosis: "UTI", Drug: "cephalexin" },
      { Diagnosis: "UTI", Drug: "cephalexin" },
      { Diagnosis: "", Drug: "" },
      { Diagnosis: "  ", Drug: "  " },
    ]);
    const wb = { fileName: "m.xlsx", sheets: [enc] };
    const m = matchRequest("most common diagnosis", wb, { present: false });
    const { plan, resultRows } = fillPlan(m, wb);
    expect(resultRows).toEqual([{ Diagnosis: "UTI", Count: 2, "Share of total": "100%" }]);
    expect(plan.summary).toMatch(/2 rows had a blank or unreadable "Diagnosis"/);
    expect(plan.summary).toMatch(/2 with a readable "Diagnosis"/);
  });

  it("does not gate on column type — a numeric column's most-common VALUE (mode) is a legitimate frequency read", () => {
    const wb = book();
    const m = matchRequest("most common duration_days", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.topN.family).toBe("frequency");
  });

  it("still declines honestly when no column can be pinned down", () => {
    const wb = book();
    const m = matchRequest("most common widgetry", wb, { present: false });
    expect(m.status).toBe("none");
    expect(m.reason).toBe("unsupported-topn");
    const off = runOffline("most common widgetry", wb, {});
    expect(off.kind).toBe("decline");
    expect(off.message).toMatch(/couldn't tell which column/);
  });
});

describe("Phase 4 — magnitude ranking (longest/shortest, numeric column only)", () => {
  it("'longest duration_days' ranks the raw rows by value, largest first, default top 1", () => {
    const wb = book();
    const m = matchRequest("longest duration_days", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.topN).toEqual({ targetColumn: "Duration_days", direction: "most", n: 1, family: "magnitude" });
    const { plan, resultRows } = fillPlan(m, wb);
    expect(resultRows).toEqual([{ Rank: 1, Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, PatientID: "P1" }]);
    expect(plan.summary).toMatch(/largest first/);
    expect(plan.summary).toMatch(/1 row had no readable number in "Duration_days" and were excluded/);
    expect(runTransformOf(plan, wb)).toEqual(resultRows);
  });

  it("'shortest duration_days' ranks ascending", () => {
    const wb = book();
    const m = matchRequest("shortest duration_days", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.topN.direction).toBe("least");
    const { plan, resultRows } = fillPlan(m, wb);
    expect(resultRows).toEqual([{ Rank: 1, Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 3, PatientID: "P5" }]);
    expect(runTransformOf(plan, wb)).toEqual(resultRows);
  });

  it("'top 2 longest duration_days' combines an explicit count with the magnitude family", () => {
    const wb = book();
    const m = matchRequest("top 2 longest duration_days", wb, { present: false });
    expect(m.status).toBe("confident");
    expect(m.topN).toEqual({ targetColumn: "Duration_days", direction: "most", n: 2, family: "magnitude" });
    const { resultRows } = fillPlan(m, wb);
    expect(resultRows.map((r) => r.Duration_days)).toEqual([10, 6]);
  });

  it("routes through the Phase 1 numeric gate: 'longest diagnosis' declines, never silently ranks text", () => {
    const wb = book();
    const m = matchRequest("longest diagnosis", wb, { present: false });
    expect(m.status).toBe("none");
    expect(m.reason).toBe("non-numeric-target");
    expect(m.targetColumn).toBe("Diagnosis");
    const off = runOffline("longest diagnosis", wb, {});
    expect(off.message).toMatch(/"Diagnosis" contains words, not numbers/);
    expect(off.message).toMatch(/rank by the size of it/);
  });

  it("a tie at the numeric cutoff is shown in full", () => {
    const enc = deriveSheet("Encounters", [
      { PatientID: "P1", Duration_days: 10 },
      { PatientID: "P2", Duration_days: 10 },
      { PatientID: "P3", Duration_days: 3 },
    ]);
    const wb = { fileName: "m.xlsx", sheets: [enc] };
    const m = matchRequest("longest duration_days", wb, { present: false });
    const { plan, resultRows } = fillPlan(m, wb);
    expect(resultRows).toHaveLength(2);
    expect(plan.summary).toMatch(/showing 2 because of a tie at the cutoff/);
  });

  it("works with a cohort filter", () => {
    const wb = book();
    const m = matchRequest("longest duration_days for patients with UTI", wb, { present: false });
    expect(m.status).toBe("confident");
    const { resultRows } = fillPlan(m, wb);
    expect(resultRows).toEqual([{ Rank: 1, Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, PatientID: "P1" }]);
  });
});

describe("Phase 4 — never a bare 'most'/'least'/'top' token (false positives over misses)", () => {
  it("'at least 5 days' / 'at most 7 days' (existing comparator phrases) are not misread as a ranking request", () => {
    const wb = book();
    expect(matchRequest("at least 5 days", wb, { present: false }).intent).not.toBe("topN");
    expect(matchRequest("at most 7 days", wb, { present: false }).intent).not.toBe("topN");
  });

  it("a plain 'top' with no number and no most/least/longest/shortest word does not trigger the family", () => {
    const wb = book();
    const m = matchRequest("top diagnosis", wb, { present: false });
    expect(m.status === "confident" ? m.intent : null).not.toBe("topN");
  });
});

describe("Phase 4 — a stretch to reach the target column confirms, never answers silently", () => {
  it("a concept-reached column is a stretch chip, same as an aggregation target", () => {
    const enc = deriveSheet("Encounters", [
      { Diagnosis: "UTI", Duration_days: 10, PatientID: "P1" },
      { Diagnosis: "pneumonia", Duration_days: 5, PatientID: "P2" },
    ]);
    const wb = { fileName: "m.xlsx", sheets: [enc] };
    const m = matchRequest("longest treatment length", wb, { present: false });
    expect(m.status).toBe("needs_confirm");
    expect(m.candidates.some((c) => c.column === "Duration_days")).toBe(true);
  });
});
