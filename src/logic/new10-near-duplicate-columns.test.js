import { describe, it, expect } from "vitest";
import { buildColumnProfile } from "./columnProfile.js";
import { deriveSheet } from "./workbook.js";

// NEW-10 (datasets-2026-07-09-realworld-examples.md): the ED-urine dataset
// has "UA Authorizing Provide" (single-letter de-identification codes: A,
// B, C...) sitting right next to "UA Authorizing Provider" (clinician
// names) — an easily-confused near-duplicate pair differing by one letter
// in the header. No engine change needed; the B6 profile table already
// shows letter/name/type/distinct-count/sample-values per column, which
// should make the two columns' very different content obvious at a glance.
// This locks that in with the real header-name shape.
describe("NEW-10 — B6 profile distinguishes near-duplicate column names by their actual content", () => {
  it("shows each column's own letter and distinct sample values, not a merged/confused view", () => {
    const sheet = deriveSheet("D", [
      { "UA Authorizing Provide": "A", "UA Authorizing Provider": "Dr. Alavi" },
      { "UA Authorizing Provide": "B", "UA Authorizing Provider": "Dr. Reyes" },
      { "UA Authorizing Provide": "A", "UA Authorizing Provider": "Dr. Alavi" },
    ]);
    const profile = buildColumnProfile(sheet);
    const code = profile.find((p) => p.name === "UA Authorizing Provide");
    const name = profile.find((p) => p.name === "UA Authorizing Provider");

    expect(code).toBeTruthy();
    expect(name).toBeTruthy();
    expect(code.letter).not.toBe(name.letter);
    // The code column's samples are single letters; the name column's
    // samples are clinician names — visibly different content at a glance.
    expect(code.summary).toMatch(/^A \(2\), B \(1\)$/);
    expect(name.summary).toMatch(/Dr\. Alavi/);
  });
});
