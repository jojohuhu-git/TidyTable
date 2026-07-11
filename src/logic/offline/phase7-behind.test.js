// @vitest-environment happy-dom
// Phase 7.8 (plan-2026-07-10-offline-smarts.md) — "show the rows behind this
// number". A plain count attaches the exact matched rows so the UI can reveal
// them; a grouped/aggregate answer (which already shows its rows) does not.

import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";

describe("Phase 7.8 — plan.behind carries the matched rows for a count", () => {
  it("a filtered count attaches exactly the matched rows", () => {
    const res = runOffline("how many records with UTI", buildExampleWorkbook(), {});
    expect(res.plan.behind.count).toBe(2);
    expect(res.plan.behind.rows).toHaveLength(2);
    expect(res.plan.behind.rows.every((r) => r.Diagnosis === "UTI")).toBe(true);
    expect(res.plan.behind.label).toMatch(/"Diagnosis" is UTI/);
  });

  it("a two-condition count attaches only the rows meeting both", () => {
    const res = runOffline("how many records with UTI and of those how many got cephalexin", buildExampleWorkbook(), {});
    expect(res.plan.behind.count).toBe(1); // P1: UTI + cephalexin
    expect(res.plan.behind.rows[0].PatientID).toBe("P1");
  });

  it("an aggregation answer does not attach behind rows (it isn't a plain count)", () => {
    const res = runOffline("average duration_days", buildExampleWorkbook(), {});
    expect(res.kind).toBe("answer");
    expect(res.plan.behind).toBeUndefined();
  });

  it("a per-group breakdown does not attach behind rows", () => {
    const res = runOffline("how many records per diagnosis", buildExampleWorkbook(), {});
    expect(res.kind).toBe("answer");
    expect(res.plan.behind).toBeUndefined();
  });
});
