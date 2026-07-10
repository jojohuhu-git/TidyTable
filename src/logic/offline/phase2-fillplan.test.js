// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { matchRequest } from "./matcher.js";
import { runOffline } from "./runOffline.js";
import { fillPlan } from "./fillPlan.js";
import { deriveSheet } from "../workbook.js";

// Phase 2 (2026-07-10): descriptive statistics with clinical reporting
// conventions, across every output surface — plain-English summary, Excel
// steps, and the worker transform (executed here, so the generated code is
// proven to reproduce the app's own numbers).

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

// Readable Duration_days: 10, 6, 5, 3 → sorted 3, 5, 6, 10.
// median 5.5, q1 4.5, q3 7, mean 6, sample SD 2.94 (2dp), min 3, max 10, range 7.

describe("Phase 2 — median (IQR) end to end", () => {
  it("summary answers in the clinical median (IQR) format with the unit named", () => {
    const wb = book();
    const { plan } = fillPlan(matchRequest("median duration_days", wb, { present: false }), wb);
    expect(plan.summary).toMatch(/5\.5 days \(IQR 4\.5–7\)/);
    expect(plan.summary).toMatch(/1 row had no readable number/);
  });

  it("Excel step teaches MEDIAN when unfiltered", () => {
    const wb = book();
    const { plan } = fillPlan(matchRequest("median duration_days", wb, { present: false }), wb);
    expect(plan.excel_steps[0].formula).toMatch(/^=MEDIAN\(/);
    expect(plan.excel_steps[0].instruction).toMatch(/5\.5/);
  });

  it("filtered median gets the honest filter-first instruction (Excel has no MEDIANIFS)", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("median duration_days for patients with UTI", wb, { present: false }), wb);
    expect(resultRows[0].Median).toBe(8); // 6 and 10 -> 8
    expect(plan.excel_steps[0].formula).toBe("");
    expect(plan.excel_steps[0].instruction).toMatch(/no "\.\.\.IFS" version/);
    expect(plan.excel_steps[0].instruction).toMatch(/MEDIAN/);
  });

  it("the transform code reproduces the same median when replayed", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("median duration_days", wb, { present: false }), wb);
    const rows = runTransformOf(plan, wb);
    expect(rows[0].Median).toBe(resultRows[0].Median);
    expect(rows[0].Median).toBe(5.5);
  });

  it("grouped median: transform, result rows, and per-group values agree", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("median duration_days per diagnosis", wb, { present: false }), wb);
    const uti = resultRows.find((r) => r.Diagnosis === "UTI");
    expect(uti.Median).toBe(8);
    const rows = runTransformOf(plan, wb);
    expect(rows.find((r) => r.Diagnosis === "UTI").Median).toBe(8);
  });
});

describe("Phase 2 — mean answers in mean (SD) format", () => {
  it("summary shows mean (SD), SD matching Excel STDEV.S", () => {
    const wb = book();
    const { plan } = fillPlan(matchRequest("average duration_days", wb, { present: false }), wb);
    // mean 6; sample SD of 3,5,6,10 = sqrt(((−3)²+(−1)²+0²+4²)/3) = sqrt(26/3) ≈ 2.94
    expect(plan.summary).toMatch(/6 days \(SD 2\.94\)/);
  });

  it("a single readable number says plainly why SD is unavailable", () => {
    const one = deriveSheet("S", [{ Dur_days: 4 }, { Dur_days: "N/A" }]);
    const wb = { fileName: "one.xlsx", sheets: [one] };
    const { plan } = fillPlan(matchRequest("average dur_days", wb, { present: false }), wb);
    expect(plan.summary).toMatch(/SD not available — fewer than 2 readable numbers/);
  });
});

describe("Phase 2 — stdev / quartiles / min / max / range", () => {
  it("stdev answers with STDEV.S parity (sample SD) and the matching Excel formula", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("standard deviation of duration_days", wb, { present: false }), wb);
    expect(resultRows[0]["Standard deviation"]).toBeCloseTo(2.94, 2);
    expect(plan.excel_steps[0].formula).toMatch(/^=STDEV\.S\(/);
    const rows = runTransformOf(plan, wb);
    expect(rows[0]["Standard deviation"]).toBe(resultRows[0]["Standard deviation"]);
  });

  it("quartiles answer as Q1/Median/Q3/IQR columns with QUARTILE.INC steps", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("quartiles of duration_days", wb, { present: false }), wb);
    expect(resultRows[0]).toMatchObject({ Q1: 4.5, Median: 5.5, Q3: 7, IQR: 2.5 });
    const formulas = plan.excel_steps.map((s) => s.formula).join(" ");
    expect(formulas).toMatch(/QUARTILE\.INC/);
    const rows = runTransformOf(plan, wb);
    expect(rows[0]).toMatchObject({ Q1: 4.5, Median: 5.5, Q3: 7, IQR: 2.5 });
  });

  it("min/max answer with MIN/MAX formulas and transform parity", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("maximum duration_days", wb, { present: false }), wb);
    expect(resultRows[0].Maximum).toBe(10);
    expect(plan.excel_steps[0].formula).toMatch(/^=MAX\(/);
    expect(runTransformOf(plan, wb)[0].Maximum).toBe(10);
  });

  it("filtered max uses MAXIFS", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("maximum duration_days for patients with UTI", wb, { present: false }), wb);
    expect(resultRows[0].Maximum).toBe(10);
    expect(plan.excel_steps[0].formula).toMatch(/^=MAXIFS\(/);
  });

  it("range answers max-minus-min with the =MAX-MIN formula and transform parity", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("range of duration_days", wb, { present: false }), wb);
    expect(resultRows[0].Range).toBe(7);
    expect(plan.summary).toMatch(/7 days \(from 3 to 10\)/);
    expect(plan.excel_steps[0].formula).toMatch(/^=MAX\(.*\)-MIN\(/);
    expect(runTransformOf(plan, wb)[0].Range).toBe(7);
  });
});

describe("Phase 2 — describe/summarize panel", () => {
  it("one panel: n, missing, mean (SD), median (IQR), min–max", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("describe duration_days", wb, { present: false }), wb);
    expect(resultRows).toEqual([{
      n: 4,
      Missing: 1,
      "Mean (SD)": "6 (SD 2.94)",
      "Median (IQR)": "5.5 (IQR 4.5–7)",
      "Min–Max": "3–10 days",
    }]);
    expect(plan.summary).toMatch(/n = 4, missing = 1/);
    expect(plan.summary).toMatch(/typical range/); // plain-English gloss for a non-coder
  });

  it("the describe Excel steps cover COUNT, AVERAGE, STDEV.S, MEDIAN, QUARTILE.INC, MIN and MAX", () => {
    const wb = book();
    const { plan } = fillPlan(matchRequest("describe duration_days", wb, { present: false }), wb);
    const all = plan.excel_steps.map((s) => `${s.formula} ${s.instruction}`).join(" ");
    for (const fn of ["COUNT", "AVERAGE", "STDEV.S", "MEDIAN", "QUARTILE.INC", "MIN", "MAX"]) {
      expect(all).toContain(fn);
    }
  });

  it("the describe transform reproduces the exact same panel, unit suffix included", () => {
    const wb = book();
    const { plan, resultRows } = fillPlan(matchRequest("describe duration_days", wb, { present: false }), wb);
    const rows = runTransformOf(plan, wb);
    expect(rows).toEqual(resultRows);
  });

  it("describe broken down per group matches asking per group", () => {
    const wb = book();
    const { resultRows } = fillPlan(matchRequest("describe duration_days per diagnosis", wb, { present: false }), wb);
    const uti = resultRows.find((r) => r.Diagnosis === "UTI");
    expect(uti["Median (IQR)"]).toBe("8 (IQR 7–9)");
    const pneumonia = resultRows.find((r) => r.Diagnosis === "pneumonia");
    expect(pneumonia.Missing).toBe(1);
    expect(pneumonia["Mean (SD)"]).toMatch(/SD not available/);
  });

  it("describe on a text column declines in plain English", () => {
    const res = runOffline("describe Diagnosis", book(), {});
    expect(res.kind).toBe("decline");
    expect(res.message).toMatch(/contains words, not numbers/);
    expect(res.message).toMatch(/describe/);
  });
});

describe("Phase 2 — unit-aware duration display", () => {
  it("an hours column is labeled hours", () => {
    const s = deriveSheet("S", [{ Wait_hours: 2 }, { Wait_hours: 4 }]);
    const wb = { fileName: "w.xlsx", sheets: [s] };
    const { plan } = fillPlan(matchRequest("median wait_hours", wb, { present: false }), wb);
    expect(plan.summary).toMatch(/3 hours \(IQR 2\.5–3\.5\)/);
  });

  it("a duration-shaped column with NO unit hint states the assumption instead of guessing", () => {
    const s = deriveSheet("S", [{ Duration: 2 }, { Duration: 4 }]);
    const wb = { fileName: "d.xlsx", sheets: [s] };
    const { plan } = fillPlan(matchRequest("median duration", wb, { present: false }), wb);
    expect(plan.summary).not.toMatch(/3 days/);
    expect(plan.summary).toMatch(/doesn't say "days" or "hours"/);
  });

  it("a non-duration numeric column gets no unit and no note", () => {
    const s = deriveSheet("S", [{ Age: 2 }, { Age: 4 }]);
    const wb = { fileName: "a.xlsx", sheets: [s] };
    const { plan } = fillPlan(matchRequest("median age", wb, { present: false }), wb);
    expect(plan.summary).toMatch(/: 3 \(IQR 2\.5–3\.5\)/);
    expect(plan.summary).not.toMatch(/doesn't say/);
  });
});

describe("Phase 2 — anticipate & suggest companions", () => {
  it("a mean answer carries a median (IQR) companion whose numbers equal asking directly", () => {
    const wb = book();
    const { plan } = fillPlan(matchRequest("average duration_days", wb, { present: false }), wb);
    expect(plan.companion).toBeTruthy();
    expect(plan.companion.kind).toBe("swap-stat");
    expect(plan.companion.intent).toBe("median");
    expect(plan.companion.label).toMatch(/median \(IQR\)/);
    expect(plan.companion.label).toMatch(/skewed/);
    const direct = fillPlan(matchRequest("median duration_days", wb, { present: false }), wb);
    expect(plan.companion.resultRows).toEqual(direct.resultRows);
  });

  it("a median answer offers the mean (SD) companion — and the companion has no companion of its own", () => {
    const wb = book();
    const { plan } = fillPlan(matchRequest("median duration_days", wb, { present: false }), wb);
    expect(plan.companion.intent).toBe("average");
    expect(plan.companion.plan.companion).toBeUndefined();
  });

  it("the companion's match is a real, replayable match (same shape matchRequest returns)", () => {
    const wb = book();
    const { plan } = fillPlan(matchRequest("average duration_days for patients with UTI", wb, { present: false }), wb);
    const alt = plan.companion.match;
    expect(alt.intent).toBe("median");
    expect(alt.aggregation.targetColumn).toBe("Duration_days");
    expect(alt.stages).toHaveLength(1);
    // Running fillPlan on it directly works — that's what replay will do.
    const { resultRows } = fillPlan(alt, wb);
    expect(resultRows[0].Median).toBe(8);
  });

  it("a count answer offers the n (%) restatement", () => {
    const wb = book();
    const { plan } = fillPlan(matchRequest("how many rows with UTI", wb, { present: false }), wb);
    expect(plan.companion.kind).toBe("n-percent");
    expect(plan.companion.answerText).toMatch(/2 \(40%\) of 5 rows/);
  });

  it("sum/min/max/distinct answers offer no companion (no standard clinical pairing)", () => {
    const wb = book();
    for (const q of ["total duration_days", "maximum duration_days", "how many different diagnoses"]) {
      const { plan } = fillPlan(matchRequest(q, wb, { present: false }), wb);
      expect(plan.companion).toBeUndefined();
    }
  });
});

describe("Phase 2 — runOffline end to end, no key needed", () => {
  it("answers a median offline", () => {
    const res = runOffline("median duration_days for patients with UTI", book(), {});
    expect(res.kind).toBe("answer");
    expect(res.resultRows[0].Median).toBe(8);
  });

  it("answers a describe panel offline", () => {
    const res = runOffline("summarize duration_days", book(), {});
    expect(res.kind).toBe("answer");
    expect(res.resultRows[0]["Mean (SD)"]).toBe("6 (SD 2.94)");
  });

  it("declines a median of a text column in plain English", () => {
    const res = runOffline("median Drug", book(), {});
    expect(res.kind).toBe("decline");
    expect(res.message).toMatch(/contains words, not numbers/);
  });
});
