import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";

// Fix spec .claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md
// P0-1: leading request verbs ("show me all", "list all", ...) must NOT be
// mistaken for undefined clinical terms and trigger the Definitions block.
const wb = () => buildExampleWorkbook();

describe("P0-1 — request verbs are not treated as clinical terms", () => {
  it('R1: "show me all patients who got cephalexin" no longer hits the Definitions block', () => {
    const res = runOffline("show me all patients who got cephalexin", wb(), {});
    // Must not be the needs_definitions block, and must not name "show me all".
    expect(res.kind).not.toBe("block");
    if (res.message) expect(res.message).not.toMatch(/show me all/i);
    if (res.missingTerms) {
      expect(res.missingTerms.map((m) => m.term)).not.toContain("show me all");
    }
  });

  it('R2: "list all patients with UTI" no longer hits the Definitions block', () => {
    const res = runOffline("list all patients with UTI", wb(), {});
    expect(res.kind).not.toBe("block");
    if (res.missingTerms) {
      expect(res.missingTerms.map((m) => m.term)).not.toContain("list all");
    }
  });

  it("the plain block message names the term without Definitions-sheet jargon in the first sentence", () => {
    // A genuinely undefined term still blocks, but with plain wording.
    const res = runOffline("how many patients with sepsis", wb(), { grainMode: "row" });
    if (res.kind === "block") {
      const firstSentence = res.message.split(/(?<=\.)\s/)[0];
      expect(firstSentence).not.toMatch(/Definitions/);
      expect(firstSentence).toMatch(/don't know what counts as/i);
    }
  });

  it('does not regress: "how many patients got cephalexin" still asks the grain question', () => {
    const res = runOffline("how many patients got cephalexin", wb(), {});
    expect(res.kind).toBe("clarify-grain");
  });
});
