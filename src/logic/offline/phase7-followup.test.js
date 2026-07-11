// @vitest-environment happy-dom
// Phase 7.1 (plan-2026-07-10-offline-smarts.md) — cross-turn follow-up questions.
// The rewrite is deterministic template reuse; these tests check both the string
// rewrite AND that runOffline reads the rewritten request the way the plan
// promises (previous cohort carried over, one value swapped).

import { describe, it, expect } from "vitest";
import { detectFollowUp, applyFollowUp, lastFilterValue } from "./followUp.js";
import { matchRequest } from "./matcher.js";
import { runOffline } from "./runOffline.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";

describe("Phase 7.1 — detectFollowUp", () => {
  it("recognizes a bare nested opener as a follow-up", () => {
    expect(detectFollowUp("of those, how many got cephalexin?")).toEqual({ kind: "nested", marker: "of those" });
    expect(detectFollowUp("and of those how many had UTI")).toEqual({ kind: "nested", marker: "and of those" });
  });

  it("recognizes 'what about X' / 'how about X' as a value swap", () => {
    expect(detectFollowUp("what about ceftriaxone?")).toEqual({ kind: "swap", value: "ceftriaxone" });
    expect(detectFollowUp("how about cephalexin")).toEqual({ kind: "swap", value: "cephalexin" });
    expect(detectFollowUp("and what about pneumonia?")).toEqual({ kind: "swap", value: "pneumonia" });
  });

  it("leaves an ordinary question that merely contains 'of those' mid-sentence alone", () => {
    expect(detectFollowUp("how many patients with UTI and of those how many got cephalexin")).toBeNull();
    expect(detectFollowUp("how many records with amoxicillin")).toBeNull();
  });
});

describe("Phase 7.1 — applyFollowUp string rewrite", () => {
  const last = { request: "how many records with UTI", swapTerm: "UTI" };

  it("glues a nested follow-up onto the previous request", () => {
    const out = applyFollowUp("of those, how many got cephalexin?", last);
    expect(out.request).toBe("how many records with UTI, of those, how many got cephalexin?");
  });

  it("swaps one value in the previous request for a 'what about' follow-up", () => {
    const out = applyFollowUp("what about pneumonia?", last);
    expect(out.request).toBe("how many records with pneumonia");
  });

  it("returns null when there is no previous question", () => {
    expect(applyFollowUp("of those, how many got cephalexin?", null)).toBeNull();
  });

  it("returns null when the swap value can't be located in the previous request", () => {
    expect(applyFollowUp("what about pneumonia?", { request: "how many rows", swapTerm: null })).toBeNull();
  });
});

describe("Phase 7.1 — the rewritten request answers correctly on the real engine", () => {
  it("nested follow-up carries the previous cohort as stage 1", () => {
    const wb = buildExampleWorkbook();
    // Turn 1: how many records with UTI → filter on Diagnosis = UTI.
    const first = matchRequest("how many records with UTI", wb, { present: false });
    expect(first.status).toBe("confident");
    const last = { request: "how many records with UTI", swapTerm: lastFilterValue(first) };
    expect(last.swapTerm).toBe("uti"); // the resolved term

    // Turn 2: of those, how many got cephalexin → two AND-ed stages.
    const rewritten = applyFollowUp("of those, how many got cephalexin", last).request;
    const res = matchRequest(rewritten, wb, { present: false });
    expect(res.status).toBe("confident");
    expect(res.stages).toHaveLength(2);
    const cols = res.stages.map((s) => s.condition.column).sort();
    expect(cols).toEqual(["Diagnosis", "Drug"]);
  });

  it("'what about' re-runs the last question with the value swapped", () => {
    const wb = buildExampleWorkbook();
    const first = matchRequest("how many records with amoxicillin", wb, { present: false });
    const last = { request: "how many records with amoxicillin", swapTerm: lastFilterValue(first) };
    const rewritten = applyFollowUp("what about cephalexin", last).request;
    expect(rewritten).toBe("how many records with cephalexin");
    const res = runOffline(rewritten, wb, {});
    expect(res.kind).toBe("answer");
    // cephalexin appears in 3 rows (P1, P4, P4).
    const lastLevel = res.exec.levels[res.exec.levels.length - 1];
    expect(lastLevel.count).toBe(3);
  });
});
