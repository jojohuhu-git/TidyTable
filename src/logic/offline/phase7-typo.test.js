// @vitest-environment happy-dom
// Phase 7.2 (plan-2026-07-10-offline-smarts.md) — typo tolerance for values.
// A near-miss must ASK ("Did you mean amoxicillin?"), never auto-answer — the
// honesty invariant: a stretched match is confirmed, never trusted silently.

import { describe, it, expect } from "vitest";
import { editDistance, findTypoCandidates } from "./valueMatch.js";
import { runOffline } from "./runOffline.js";
import { matchRequest } from "./matcher.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";
import { deriveSheet } from "../workbook.js";

describe("Phase 7.2 — editDistance", () => {
  it("counts single edits and honors the early-exit cap", () => {
    expect(editDistance("amoxicilin", "amoxicillin")).toBe(1);
    expect(editDistance("cat", "cat")).toBe(0);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("abcdefg", "xyz", 2)).toBe(3); // exceeds cap → cap+1
  });
});

describe("Phase 7.2 — findTypoCandidates", () => {
  const wb = buildExampleWorkbook();
  const sheet = wb.sheets[0];
  // The matcher builds this index internally; rebuild the same shape here.
  const index = new Map();
  for (const h of sheet.headers) {
    const m = new Map();
    for (const r of sheet.rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") continue;
      const k = String(v).trim().toLowerCase();
      if (!m.has(k)) m.set(k, v);
    }
    index.set(h.name, m);
  }

  it("finds a double-letter drug misspelling", () => {
    // The British/American spelling fold also collapses "ll"->"l", so a dropped
    // double letter ("amoxicilin") lands at distance 0 — still a stretch chip.
    const cands = findTypoCandidates("amoxicilin", sheet.headers, index);
    expect(cands[0]).toMatchObject({ column: "Drug", value: "amoxicillin" });
    expect(cands[0].distance).toBe(0);
  });

  it("finds a genuine one-edit misspelling (a transposed/wrong letter)", () => {
    const cands = findTypoCandidates("cephalexn", sheet.headers, index);
    expect(cands[0]).toMatchObject({ column: "Drug", value: "cephalexin" });
    expect(cands[0].distance).toBe(1);
  });

  it("does NOT correct a short word (no budget under 4 chars)", () => {
    // "cti" is one edit from "uti" but 3-letter words get a zero typo budget.
    expect(findTypoCandidates("cti", sheet.headers, index)).toEqual([]);
  });

  it("folds British/American spellings to distance 0", () => {
    const s = deriveSheet("S", [{ Cohort: "paediatric" }, { Cohort: "adult" }]);
    const idx = new Map([["Cohort", new Map([["paediatric", "paediatric"], ["adult", "adult"]])]]);
    const cands = findTypoCandidates("pediatric", s.headers, idx);
    expect(cands[0]).toMatchObject({ column: "Cohort", value: "paediatric", distance: 0 });
  });
});

describe("Phase 7.2 — the engine asks, never auto-answers, on a typo", () => {
  it("a misspelled drug becomes a 'Did you mean…?' confirm, not an answer", () => {
    const res = runOffline("how many records with amoxicilin", buildExampleWorkbook(), {});
    expect(res.kind).toBe("confirm-value");
    expect(res.candidates.some((c) => c.value === "amoxicillin")).toBe(true);
  });

  it("the underlying match is needs_confirm (a stretch), so it never answers straight away", () => {
    const m = matchRequest("how many records with amoxicilin", buildExampleWorkbook(), { present: false });
    expect(m.status).toBe("needs_confirm");
  });
});
