// Phase 8.6 (plan-2026-07-10-offline-smarts.md) — the chart-flavored phrase
// bank. Same self-teaching machinery as the Step 3 bank (phrase-bank.test.js),
// pointed at the chart engine: templates + slot vocabulary are expanded and run
// through the REAL resolveChartRequest, which since Phase 8.1 routes through the
// same Step 3 matcher. "Done" is measured the same way:
//   - >= 90% of expanded phrasings RESOLVE-or-ASK correctly, and
//   - EXACTLY 0 confident-wrong (a resolved chart whose axes contradict what the
//     phrasing asked — the never-guess promise, applied to pictures).

import { describe, it, expect } from "vitest";
import bank from "./chart-phrase-bank.json";
import { deriveSheet } from "../src/logic/workbook.js";
import { resolveChartRequest } from "../src/logic/charts/textToChart.js";

const TARGET_PASS_RATE = 0.9;

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 5, Cost: 100, Ward: "ICU" },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 3, Cost: 200, Ward: "General" },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 7, Cost: 150, Ward: "General" },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cefpodoxime", Duration_days: 2, Cost: 80, Ward: "ICU" },
  ]);
}

function expand(template, sharedSlots, entrySlots = {}) {
  const slotNames = [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  let phrasings = [template];
  for (const name of slotNames) {
    const values = entrySlots[name] || sharedSlots[name];
    if (!values) throw new Error(`chart-phrase-bank: template "${template}" uses undefined slot {${name}}`);
    const next = [];
    for (const p of phrasings) for (const v of values) next.push(p.replaceAll(`{${name}}`, v));
    phrasings = next;
  }
  return phrasings;
}

// Does a resolved chart's axes match what the entry said the phrasing means?
function shapeMatches(res, shape) {
  if (!shape) return false;
  if (shape.aggMode && res.aggMode !== shape.aggMode) return false;
  if ("valueCol" in shape && res.valueCol !== shape.valueCol) return false;
  if (shape.labelCol && res.labelCol !== shape.labelCol) return false;
  if (shape.rankDirection && res.rank?.direction !== shape.rankDirection) return false;
  return true;
}

function grade(phrasing, entry, sh) {
  const res = resolveChartRequest(phrasing, sh);
  if (res.status === "resolved") {
    // A stretch is the chart's "Did you mean…?" confirm — an honest ask, never
    // a silent draw.
    if (res.confidence === "stretched") return { category: "asked" };
    if (entry.shape) {
      return shapeMatches(res, entry.shape)
        ? { category: "resolved-correct" }
        : { category: "confident-wrong", res };
    }
    return entry.accept.includes("resolved")
      ? { category: "resolved-unverified" }
      : { category: "confident-wrong", res };
  }
  // status "none" — a decline.
  return entry.accept.includes("decline") ? { category: "declined-correct" } : { category: "miss" };
}

describe("Phase 8.6 chart phrase bank — templates expanded and run on the real chart engine", () => {
  const sh = sheet();
  const results = [];
  const confidentWrong = [];
  const misses = [];

  for (const entry of bank.entries) {
    for (const template of entry.templates) {
      for (const phrasing of expand(template, bank.slots, entry.slots)) {
        const g = grade(phrasing, entry, sh);
        results.push({ phrasing, entryId: entry.id, category: g.category });
        if (g.category === "confident-wrong") confidentWrong.push({ phrasing, entryId: entry.id, got: g.res });
        if (g.category === "miss") misses.push({ phrasing, entryId: entry.id });
      }
    }
  }

  const total = results.length;
  const passes = results.filter((r) => r.category !== "confident-wrong" && r.category !== "miss").length;
  const passRate = total ? passes / total : 0;

  it("expands to a varied set of chart phrasings", () => {
    expect(total).toBeGreaterThanOrEqual(40);
  });

  it("is NEVER confident-wrong (the never-guess promise, applied to charts)", () => {
    if (confidentWrong.length) {
      // eslint-disable-next-line no-console
      console.error("CHART CONFIDENT-WRONG:\n" + JSON.stringify(confidentWrong, null, 2));
    }
    expect(confidentWrong).toEqual([]);
  });

  it(`resolves or asks correctly for >= ${TARGET_PASS_RATE * 100}% of phrasings`, () => {
    const byCat = results.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {});
    // eslint-disable-next-line no-console
    console.log(
      `\nChart phrase bank: ${passes}/${total} passed (${(passRate * 100).toFixed(1)}%), ` +
      `confident-wrong: ${confidentWrong.length}.\nBreakdown: ${JSON.stringify(byCat)}\n` +
      (misses.length ? `Misses:\n${misses.map((m) => "  - " + m.phrasing).join("\n")}\n` : ""),
    );
    expect(passRate).toBeGreaterThanOrEqual(TARGET_PASS_RATE);
  });
});
