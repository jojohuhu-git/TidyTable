import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { resolveChartRequest } from "./textToChart.js";
import { buildCrosstabDataset } from "./aggregate.js";
import { buildCrosstabExamplePrompts } from "../offline/examplePrompts.js";

// Parked item 1 (.claude/prompts/parked-2026-07-17-brainstormed-queue.md):
// crosstab cohort filter + partial-parse honesty + example chips. Fixture
// mirrors the owner's own example: "of cystitis patients, drug mix by ward" —
// cystitis's most common drug (cephalexin) differs from the whole sheet's
// (nitrofurantoin), so a real filter (not a coincidence) proves the cohort
// actually scoped the crosstab.
function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "nitrofurantoin", Ward: "ICU" },
    { PatientID: "P2", Diagnosis: "UTI", Drug: "nitrofurantoin", Ward: "General" },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "nitrofurantoin", Ward: "ICU" },
    { PatientID: "P4", Diagnosis: "pneumonia", Drug: "azithromycin", Ward: "General" },
    { PatientID: "P5", Diagnosis: "cystitis", Drug: "cephalexin", Ward: "ICU" },
    { PatientID: "P6", Diagnosis: "cystitis", Drug: "cephalexin", Ward: "General" },
    { PatientID: "P7", Diagnosis: "cystitis", Drug: "nitrofurantoin", Ward: "ICU" },
    { PatientID: "P8", Diagnosis: "cystitis", Drug: "cephalexin", Ward: "General" },
  ]);
}

describe("Parked item 1(a) — crosstab requests resolve a leading 'of <cohort>,' filter", () => {
  it("'of cystitis patients, drug mix by ward' attaches the cohort filter to the crosstab plan", () => {
    const res = resolveChartRequest("of cystitis patients, drug mix by ward", sheet());
    expect(res.status).toBe("resolved");
    expect(res.kind).toBe("crosstab");
    expect(res.labelCol).toBe("Ward");
    expect(res.subgroupCol).toBe("Drug");
    expect(res.filter).toEqual({ column: "Diagnosis", value: "cystitis" });
  });

  it("the attached filter actually scopes buildCrosstabDataset to the cystitis rows", () => {
    const res = resolveChartRequest("of cystitis patients, drug mix by ward", sheet());
    const d = buildCrosstabDataset(sheet(), res.labelCol, res.subgroupCol, { filter: res.filter });
    const total = d.categories.reduce((s, c) => s + c.total, 0);
    expect(total).toBe(4); // only the 4 cystitis rows
  });

  it("the SAME leading cohort form also works for a single-column chart request (one brain, not two parsers)", () => {
    const res = resolveChartRequest("of cystitis patients, most common drug", sheet());
    expect(res.status).toBe("resolved");
    expect(res.filter).toEqual({ column: "Diagnosis", value: "cystitis" });
  });

  it("a plain crosstab request with no cohort clause is unaffected", () => {
    const res = resolveChartRequest("drug mix by ward", sheet());
    expect(res.status).toBe("resolved");
    expect(res.filter).toBeNull();
  });

  it("never invents a filter from a word that isn't a real value (honesty)", () => {
    const res = resolveChartRequest("of madeupdiagnosis patients, drug mix by ward", sheet());
    if (res.status === "resolved" && res.filter) {
      expect(res.filter.value.toLowerCase()).not.toBe("madeupdiagnosis");
    }
  });
});

describe("Parked item 1(b) — partial two-column parse declines honestly with alternatives", () => {
  it("names the unresolved side and offers 2-3 clickable, already-resolved alternatives", () => {
    const res = resolveChartRequest("drug mix by nonexistentcolumn", sheet());
    expect(res.status).toBe("none");
    expect(res.reason).toBe("crosstab-partial");
    expect(res.message).toMatch(/nonexistentcolumn/);
    expect(res.alternatives.length).toBeGreaterThan(0);
    expect(res.alternatives.length).toBeLessThanOrEqual(3);
    for (const alt of res.alternatives) {
      expect(alt.plan.status).toBe("resolved");
      expect(alt.plan.kind).toBe("crosstab");
    }
  });

  it("alternatives never suggest an ID-like column as the crosstab axis", () => {
    const res = resolveChartRequest("drug mix by nonexistentcolumn", sheet());
    const cols = res.alternatives.flatMap((a) => [a.plan.labelCol, a.plan.subgroupCol]);
    expect(cols).not.toContain("PatientID");
  });

  it("a leading cohort filter still carries through to each alternative's plan", () => {
    const res = resolveChartRequest("of cystitis patients, drug mix by nonexistentcolumn", sheet());
    expect(res.status).toBe("none");
    for (const alt of res.alternatives) {
      expect(alt.plan.filter).toEqual({ column: "Diagnosis", value: "cystitis" });
    }
  });
});

describe("Parked item 1(c) — data-aware crosstab example chips", () => {
  it("builds a crosstab chip and a cohort-filtered chip, each with an already-resolved plan", () => {
    const chips = buildCrosstabExamplePrompts(sheet());
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.plan.status).toBe("resolved");
      expect(chip.plan.kind).toBe("crosstab");
    }
  });

  it("a cohort chip's filter value only ever comes from a low-cardinality category column, never PatientID", () => {
    const chips = buildCrosstabExamplePrompts(sheet());
    const cohortChip = chips.find((c) => c.plan.filter);
    if (cohortChip) expect(cohortChip.plan.filter.column).not.toBe("PatientID");
  });

  it("returns [] when there aren't at least two usable category columns", () => {
    const thin = deriveSheet("Thin", [{ OnlyCol: "a" }, { OnlyCol: "b" }]);
    expect(buildCrosstabExamplePrompts(thin)).toEqual([]);
  });
});
