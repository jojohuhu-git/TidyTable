import { describe, it, expect } from "vitest";
import { nextTabIndex } from "./tabsKeyboard.js";

describe("B12 — nextTabIndex (arrow-key tablist navigation)", () => {
  it("ArrowRight moves to the next tab and wraps past the last one", () => {
    expect(nextTabIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextTabIndex("ArrowRight", 2, 3)).toBe(0);
  });

  it("ArrowLeft moves to the previous tab and wraps past the first one", () => {
    expect(nextTabIndex("ArrowLeft", 1, 3)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("Home and End jump to the first/last tab", () => {
    expect(nextTabIndex("Home", 2, 3)).toBe(0);
    expect(nextTabIndex("End", 0, 3)).toBe(2);
  });

  it("any other key is ignored", () => {
    expect(nextTabIndex("Enter", 1, 3)).toBeNull();
    expect(nextTabIndex("a", 1, 3)).toBeNull();
  });
});
