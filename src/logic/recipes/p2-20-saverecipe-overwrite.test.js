// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { saveRecipe, listRecipes } from "./recipe.js";

// P2-20: saving a recipe under a name that already belongs to a DIFFERENT
// recipe (different createdAt) used to silently overwrite it. Saving the
// SAME recipe again under its own name is still an intentional in-place
// update, so that must not get suffixed.
describe("P2-20 — saveRecipe never silently overwrites a different recipe", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("auto-suffixes a name collision with a different recipe instead of overwriting it", () => {
    const first = saveRecipe({ version: 1, name: "Monthly cleanup", createdAt: "2026-01-01T00:00:00.000Z", steps: [{ a: 1 }] });
    const second = saveRecipe({ version: 1, name: "Monthly cleanup", createdAt: "2026-02-01T00:00:00.000Z", steps: [{ b: 2 }] });

    expect(first.name).toBe("Monthly cleanup");
    expect(second.name).toBe("Monthly cleanup (2)");

    const lib = listRecipes();
    expect(lib.find((r) => r.name === "Monthly cleanup").steps).toEqual([{ a: 1 }]);
    expect(lib.find((r) => r.name === "Monthly cleanup (2)").steps).toEqual([{ b: 2 }]);
  });

  it("re-saving the same recipe (same createdAt) under its own name updates it in place", () => {
    saveRecipe({ version: 1, name: "Monthly cleanup", createdAt: "2026-01-01T00:00:00.000Z", steps: [{ a: 1 }] });
    const updated = saveRecipe({ version: 1, name: "Monthly cleanup", createdAt: "2026-01-01T00:00:00.000Z", steps: [{ a: 1 }, { a: 2 }] });

    expect(updated.name).toBe("Monthly cleanup");
    expect(listRecipes()).toHaveLength(1);
    expect(listRecipes()[0].steps).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("keeps incrementing the suffix past an already-taken '(2)'", () => {
    saveRecipe({ version: 1, name: "X", createdAt: "2026-01-01T00:00:00.000Z", steps: [] });
    saveRecipe({ version: 1, name: "X (2)", createdAt: "2026-01-02T00:00:00.000Z", steps: [] });
    const third = saveRecipe({ version: 1, name: "X", createdAt: "2026-01-03T00:00:00.000Z", steps: [] });
    expect(third.name).toBe("X (3)");
  });
});
