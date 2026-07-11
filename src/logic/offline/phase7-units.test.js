// @vitest-environment happy-dom
// Phase 7.3 (plan-2026-07-10-offline-smarts.md) — number words + unit
// conversion in comparators. "more than a week" converts to > 7 on a days
// column, and the conversion (and any month/hour approximation) is stated in
// the trust line — never a silent stretch.

import { describe, it, expect } from "vitest";
import { parseQuantity, convertQuantityToColumn } from "./units.js";
import { matchRequest } from "./matcher.js";
import { runOffline } from "./runOffline.js";
import { deriveSheet } from "../workbook.js";

function book() {
  const enc = deriveSheet("Encounters", [
    { PatientID: "P1", Duration_days: 3 },
    { PatientID: "P2", Duration_days: 7 },
    { PatientID: "P3", Duration_days: 10 },
    { PatientID: "P4", Duration_days: 14 },
    { PatientID: "P5", Duration_days: 40 },
  ]);
  return { fileName: "m.xlsx", sheets: [enc] };
}

describe("Phase 7.3 — parseQuantity", () => {
  it("reads number words and digits with a time unit", () => {
    expect(parseQuantity("more than a week")).toMatchObject({ number: 1, unit: "weeks", days: 7 });
    expect(parseQuantity("over 2 weeks")).toMatchObject({ number: 2, unit: "weeks", days: 14 });
    expect(parseQuantity("under 48 hours")).toMatchObject({ number: 48, unit: "hours" });
    expect(parseQuantity("at least three months")).toMatchObject({ number: 3, unit: "months", approx: true });
  });
  it("returns null for a bare number with no unit", () => {
    expect(parseQuantity("more than 7")).toBeNull();
  });
});

describe("Phase 7.3 — convertQuantityToColumn", () => {
  it("converts weeks to a days column, exactly", () => {
    expect(convertQuantityToColumn(parseQuantity("a week"), "Duration_days")).toMatchObject({ value: 7, approx: false });
  });
  it("marks a month conversion as approximate and says so", () => {
    const conv = convertQuantityToColumn(parseQuantity("a month"), "Duration_days");
    expect(conv.value).toBe(30);
    expect(conv.approx).toBe(true);
    expect(conv.note).toMatch(/a month taken as 30 days/i);
  });
  it("refuses (null) when the column's unit is unknown — no guessing", () => {
    expect(convertQuantityToColumn(parseQuantity("a week"), "Duration")).toBeNull();
  });
});

describe("Phase 7.3 — the engine converts and states it in the trust line", () => {
  it("'more than a week' becomes > 7 on Duration_days", () => {
    const m = matchRequest("how many records with duration_days more than a week", book(), { present: false });
    expect(m.status).toBe("confident");
    const th = m.stages.find((s) => s.condition.kind === "threshold").condition;
    expect(th.op).toBe(">");
    expect(th.value).toBe(7);
    expect(m.lookedFor).toMatch(/from "1 week = 7 days"/i);
  });

  it("answers the correct count for a week threshold (3 rows over 7 days)", () => {
    const res = runOffline("how many records with duration_days more than a week", book(), {});
    expect(res.kind).toBe("answer");
    const last = res.exec.levels[res.exec.levels.length - 1];
    expect(last.count).toBe(3); // 10, 14, 40
  });

  it("'at least 2 weeks' becomes >= 14 (2 rows)", () => {
    const res = runOffline("how many records with duration_days at least 2 weeks", book(), {});
    const last = res.exec.levels[res.exec.levels.length - 1];
    expect(last.count).toBe(2); // 14, 40
  });

  it("a month conversion states the approximation in the trust line", () => {
    const m = matchRequest("how many records with duration_days over a month", book(), { present: false });
    expect(m.lookedFor).toMatch(/a month taken as 30 days/i);
  });
});
