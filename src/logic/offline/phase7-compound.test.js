// @vitest-environment happy-dom
// Phase 7.4 (plan-2026-07-10-offline-smarts.md) — compound "and" questions.
// The split must fire ONLY when both sides are genuine, independent intents;
// a value set ("amoxicillin and cephalexin") must never be split into questions.

import { describe, it, expect } from "vitest";
import { splitCompound } from "./compound.js";
import { runOffline } from "./runOffline.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";

describe("Phase 7.4 — splitCompound", () => {
  it("splits two independent intents and distributes a shared 'by X' tail", () => {
    expect(splitCompound("average duration and most common drug by diagnosis")).toEqual([
      "average duration by diagnosis",
      "most common drug by diagnosis",
    ]);
  });

  it("splits two count questions", () => {
    expect(splitCompound("how many records with UTI and how many with pneumonia")).toEqual([
      "how many records with UTI",
      "how many with pneumonia",
    ]);
  });

  it("does NOT split a value set joined by 'and'", () => {
    // "amoxicillin" has no intent of its own → the 'and' joined values.
    expect(splitCompound("how many records with amoxicillin and cephalexin")).toBeNull();
  });

  it("does NOT split a cohort with an 'and' value tail", () => {
    expect(splitCompound("average duration_days for patients with UTI and pneumonia")).toBeNull();
  });

  it("leaves a nested 'of those' follow-up and single questions alone", () => {
    expect(splitCompound("of patients with UTI, and of those how many got cephalexin")).toBeNull();
    expect(splitCompound("average duration_days")).toBeNull();
  });
});

describe("Phase 7.4 — each part answers on the real engine", () => {
  it("both parts of the example compound answer confidently", () => {
    const wb = buildExampleWorkbook();
    const parts = splitCompound("average duration and most common drug");
    expect(parts).toEqual(["average duration", "most common drug"]);
    for (const p of parts) {
      const res = runOffline(p, wb, {});
      expect(res.kind === "answer" || res.kind === "confirm-value").toBe(true);
    }
  });
});
