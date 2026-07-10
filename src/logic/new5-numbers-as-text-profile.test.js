import { describe, it, expect } from "vitest";
import { buildColumnProfile } from "./columnProfile.js";
import { columnPickerOptions } from "./columnPickerOptions.js";
import { deriveSheet } from "./workbook.js";

// NEW-5 (datasets-2026-07-09-realworld-examples.md): the DC-abx dataset's
// "Admission SCr" column is 406 text-formatted numbers ("0.69", "1.04") with
// exactly 1 real native float mixed in — inferType calls this "mixed (text +
// numbers)" (accurate at the raw level), but B6's profile table should
// recognize it's really numeric and show a min-max range, not a
// top-3-by-frequency list of near-unique text values.
function mixedNumericColumn() {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ SCr: `${(0.5 + i * 0.1).toFixed(2)}` }); // text numbers
  rows.push({ SCr: 1.25 }); // the one real float
  return deriveSheet("D", rows);
}

describe("NEW-5 — B6 profile recognizes a numbers-as-text column with a stray real float", () => {
  it("labels the column 'number (stored as text)' and shows a numeric range", () => {
    const profile = buildColumnProfile(mixedNumericColumn());
    const scr = profile.find((p) => p.name === "SCr");
    expect(scr.type).toBe("number (stored as text)");
    expect(scr.summary).toBe("0.5 – 1.25");
  });

  it("a genuinely mixed column (real text alongside numbers) is not relabeled", () => {
    const sheet = deriveSheet("D", [{ X: "abc" }, { X: 5 }, { X: 6 }]);
    const profile = buildColumnProfile(sheet);
    expect(profile.find((p) => p.name === "X").type).toBe("mixed (text + numbers)");
  });

  it("a plain text column (no coercible values) is not relabeled", () => {
    const sheet = deriveSheet("D", [{ X: "abc" }, { X: "def" }]);
    const profile = buildColumnProfile(sheet);
    expect(profile.find((p) => p.name === "X").type).toBe("text");
  });
});

describe("NEW-5 — B10 picker treats 'number (stored as text)' as numeric", () => {
  it("badges it with its numeric type and ranks it first for an outcome role", () => {
    const opts = columnPickerOptions(mixedNumericColumn(), "outcome");
    expect(opts[0].name).toBe("SCr");
    expect(opts[0].badge).toBe("number (stored as text)");
    expect(opts[0].likely).toBe(true);
  });
});
