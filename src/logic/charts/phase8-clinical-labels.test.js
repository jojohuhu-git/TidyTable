import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildDataset, countLabel } from "./aggregate.js";

// Phase 8.3 — clinical presentation defaults: a COUNT bar is labeled n (%) of
// the cohort; a sum/average total is not a share of a whole, so it stays bare.

function sheet(rows) { return deriveSheet("D", rows); }

describe("Phase 8.3 — countTotal denominator", () => {
  it("captures the full cohort size on a count dataset", () => {
    const ds = buildDataset(sheet([{ W: "A" }, { W: "A" }, { W: "B" }]), "W", null);
    expect(ds.countTotal).toBe(3);
  });

  it("carries the whole-cohort denominator through a top-N cap (so % is of the whole)", async () => {
    const { applyRankCap } = await import("./aggregate.js");
    const ds = buildDataset(sheet([{ W: "A" }, { W: "A" }, { W: "A" }, { W: "B" }, { W: "C" }]), "W", null);
    const capped = applyRankCap(ds, { n: 1, direction: "most" });
    // Only "A" shown, but the denominator is still all 5 rows.
    expect(capped.countTotal).toBe(5);
  });

  it("does NOT set countTotal for a sum/average chart (not a share of a whole)", () => {
    const sum = buildDataset(sheet([{ W: "A", Cost: 5 }, { W: "A", Cost: 3 }]), "W", "Cost", { aggMode: "sum" });
    expect(sum.countTotal).toBeUndefined();
    const avg = buildDataset(sheet([{ W: "A", Cost: 5 }, { W: "A", Cost: 3 }]), "W", "Cost", { aggMode: "average" });
    expect(avg.countTotal).toBeUndefined();
  });
});

describe("Phase 8.3 — countLabel formats n (%)", () => {
  it("shows the count and its whole-percent share", () => {
    expect(countLabel(5, 10)).toBe("5 (50%)");
    expect(countLabel(1, 3)).toBe("1 (33%)");
  });

  it("falls back to the bare number with no denominator (a sum/average)", () => {
    expect(countLabel(8, null)).toBe("8");
    expect(countLabel(8, 0)).toBe("8");
  });
});
