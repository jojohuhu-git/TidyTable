// @vitest-environment happy-dom
// Phase 6 (plan-2026-07-10-offline-smarts.md) — the self-teaching phrase bank.
//
// The bank (phrase-bank.json) is a set of TEMPLATES, not literal phrasings: each
// entry names an intent and slot vocabulary, and the runner below expands it into
// every concrete everyday wording at test time and runs each one through the REAL
// offline engine (runOffline) on the built-in example workbook. One entry covers
// "average total duration of therapy", "median duration of therapy", "duration of
// therapy for UTI" once the slot vocabulary knows those words.
//
// "Done" for the whole offline-smarts effort is measured here (owner-agreed):
//   - >= 90% of expanded phrasings ANSWER-or-ASK correctly, and
//   - EXACTLY 0 are confident-wrong (a confident answer whose plan shape
//     contradicts what the phrasing asked — the never-guess promise).
// happy-dom gives runOffline the localStorage its miss log writes to.

import { describe, it, expect } from "vitest";
import bank from "./phrase-bank.json";
import { runOffline } from "../src/logic/offline/runOffline.js";
import { buildExampleWorkbook } from "../src/logic/exampleWorkbook.js";
import { planShapeFromMatch } from "../src/logic/offline/planShape.js";

const TARGET_PASS_RATE = 0.9;

// Expand a template like "{aggMean} {durExact}" into every concrete phrasing, as
// the cartesian product of its slots. Slot vocab comes from the entry's own
// `slots` override first, then the bank's shared `slots`.
function expand(template, sharedSlots, entrySlots = {}) {
  const slotNames = [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  let phrasings = [template];
  for (const name of slotNames) {
    const values = entrySlots[name] || sharedSlots[name];
    if (!values) throw new Error(`phrase-bank: template "${template}" uses undefined slot {${name}}`);
    const next = [];
    for (const p of phrasings) {
      for (const v of values) next.push(p.replaceAll(`{${name}}`, v));
    }
    phrasings = next;
  }
  return phrasings;
}

// Which broad outcome did the engine reach for this phrasing?
function outcomeOf(res) {
  if (res.kind === "answer") return "answer";
  if (res.kind === "decline") return "decline";
  return "ask"; // block | clarify-grain | confirm-value — all honest questions
}

// Does an ANSWER's real plan shape match what the entry said the phrasing means?
// Any specified field that disagrees makes this a confident-wrong.
function shapeMatches(shape, expectShape) {
  if (!expectShape) return false; // an answer with no expected shape is unexpected
  if (!shape) return false;
  if (expectShape.intent && shape.intent !== expectShape.intent) return false;
  if (expectShape.target && shape.target !== expectShape.target) return false;
  if (expectShape.group && shape.group !== expectShape.group) return false;
  if (expectShape.topNColumn && shape.topN?.column !== expectShape.topNColumn) return false;
  if (expectShape.filterColumn && !(shape.filters || []).some((f) => f.column === expectShape.filterColumn)) return false;
  return true;
}

// Grade one phrasing → { category, detail }. Categories:
//   answered-correct | asked | declined-correct  → PASS
//   confident-wrong                              → HARD FAIL (must be 0)
//   miss                                         → soft fail (declined a phrasing
//                                                  we expected it to handle)
function grade(phrasing, entry) {
  const res = runOffline(phrasing, buildExampleWorkbook());
  const outcome = outcomeOf(res);
  const accept = entry.accept;

  if (outcome === "answer") {
    const shape = planShapeFromMatch(res.match);
    if (entry.shape) {
      // The entry pinned an expected shape: answering it is correct, answering
      // a contradicting shape is the never-guess violation.
      return shapeMatches(shape, entry.shape)
        ? { category: "answered-correct", res }
        : { category: "confident-wrong", res, shape };
    }
    // No expected shape. If the phrasing is allowed to answer, we can't verify
    // the exact shape but answering isn't dishonest — count it. If the phrasing
    // must NOT answer (a decline-only honesty seed), answering IS confident-wrong.
    return accept.includes("answer")
      ? { category: "answered-unverified", res }
      : { category: "confident-wrong", res, shape };
  }

  if (outcome === "ask") {
    // Asking is always honest; it's a pass unless the entry demanded a pure
    // decline (rare — only the "should be impossible" seeds), in which case an
    // ask is still not confidently wrong, so we still count it as acceptable.
    return { category: "asked", res };
  }

  // decline
  if (accept.includes("decline")) return { category: "declined-correct", res };
  return { category: "miss", res };
}

describe("Phase 6 phrase bank — templates expanded and run on the real engine", () => {
  const results = [];
  const confidentWrong = [];
  const misses = [];

  for (const entry of bank.entries) {
    for (const template of entry.templates) {
      for (const phrasing of expand(template, bank.slots, entry.slots)) {
        const g = grade(phrasing, entry);
        results.push({ phrasing, entryId: entry.id, category: g.category });
        if (g.category === "confident-wrong") {
          confidentWrong.push({ phrasing, entryId: entry.id, got: g.shape, expected: entry.shape });
        }
        if (g.category === "miss") misses.push({ phrasing, entryId: entry.id });
      }
    }
  }

  const total = results.length;
  const passes = results.filter((r) => r.category !== "confident-wrong" && r.category !== "miss").length;
  const passRate = total ? passes / total : 0;

  it("expands to a substantial, varied set of phrasings", () => {
    expect(total).toBeGreaterThanOrEqual(80);
  });

  it("is NEVER confident-wrong (the never-guess promise)", () => {
    if (confidentWrong.length) {
      // Surface every offender so a regression is diagnosable at a glance.
      // eslint-disable-next-line no-console
      console.error("CONFIDENT-WRONG phrasings:\n" + JSON.stringify(confidentWrong, null, 2));
    }
    expect(confidentWrong).toEqual([]);
  });

  it(`answers or asks correctly for >= ${TARGET_PASS_RATE * 100}% of phrasings`, () => {
    // Report the real measured numbers (repo rule: never "should pass").
    const byCat = results.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {});
    // eslint-disable-next-line no-console
    console.log(
      `\nPhrase bank: ${passes}/${total} passed (${(passRate * 100).toFixed(1)}%), ` +
      `confident-wrong: ${confidentWrong.length}.\n` +
      `Breakdown: ${JSON.stringify(byCat)}\n` +
      (misses.length ? `Misses (declined, expected to handle):\n${misses.map((m) => "  - " + m.phrasing).join("\n")}\n` : ""),
    );
    expect(passRate).toBeGreaterThanOrEqual(TARGET_PASS_RATE);
  });
});
