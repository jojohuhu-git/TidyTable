import { describe, it, expect } from "vitest";
import { estimateCostUSD } from "./claude.js";

// P2-21: Sonnet 5's $2/MTok is an introductory price that ends 2026-08-31.
// estimateCostUSD used to hardcode $2 forever, silently under-quoting cost
// after the intro price lapsed. It now takes the "as of" date so this is
// testable without waiting for the calendar, and defaults to the real
// current date in normal use.
describe("P2-21 — estimateCostUSD reverts to the standard Sonnet 5 price after the intro period", () => {
  it("charges the $2/MTok intro price while it's still in effect", () => {
    const cost = estimateCostUSD("claude-sonnet-5", 1_000_000, new Date("2026-08-31T00:00:00Z"));
    expect(cost).toBe(2);
  });

  it("charges the $3/MTok standard price once the intro period has ended", () => {
    const cost = estimateCostUSD("claude-sonnet-5", 1_000_000, new Date("2026-09-01T00:00:00Z"));
    expect(cost).toBe(3);
  });

  it("other models are unaffected by the date", () => {
    expect(estimateCostUSD("claude-opus-4-8", 1_000_000, new Date("2027-01-01"))).toBe(5);
    expect(estimateCostUSD("claude-haiku-4-5", 1_000_000, new Date("2027-01-01"))).toBe(1);
  });
});
