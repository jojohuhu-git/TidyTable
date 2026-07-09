import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { buildFixPlan } from "./buildFixPlan.js";
import { censoredValues } from "./normalizers.js";

// P1-7: "exclude" is a no-op in the app (censoredValues(v, "exclude") === v),
// but the Excel step used to always emit the "boundary" formula regardless of
// policy — so Excel would convert "<0.5" to 0.5 while the app left it as
// text. The two "must agree" outputs must actually agree.

describe("P1-7 — censored 'exclude' policy: app and Excel step agree", () => {
  it("the app leaves the value exactly as-is for 'exclude'", () => {
    expect(censoredValues("<0.5", "exclude")).toBe("<0.5");
  });

  it("the Excel step for 'exclude' has no formula and says nothing changes", () => {
    const sheet = deriveSheet("Labs", [{ WBC: "<0.5" }, { WBC: "12.4" }]);
    const fixes = [{ normalizer: "censoredValues", column: "WBC", params: { policy: "exclude" } }];
    const { plan } = buildFixPlan(sheet, fixes);
    const step = plan.excel_steps.find((s) => s.column !== "dedupe" && s.title.includes("as-is"));
    expect(step.formula).toBe("");
    expect(step.instruction).toMatch(/no cells change|exactly as they are/i);
    expect(step.instruction).not.toMatch(/0\.5\)/); // no boundary-substitution formula text leaking in
  });

  it("'exclude' does not emit the boundary formula that would convert <0.5 to 0.5", () => {
    const sheet = deriveSheet("Labs", [{ WBC: "<0.5" }]);
    const fixes = [{ normalizer: "censoredValues", column: "WBC", params: { policy: "exclude" } }];
    const { plan } = buildFixPlan(sheet, fixes);
    const step = plan.excel_steps[0];
    expect(step.formula).not.toMatch(/SUBSTITUTE/);
  });

  it("cellsChanged is honestly 0 for 'exclude' in the cleaning log", () => {
    const sheet = deriveSheet("Labs", [{ WBC: "<0.5" }, { WBC: "12.4" }]);
    const fixes = [{ normalizer: "censoredValues", column: "WBC", params: { policy: "exclude" } }];
    const { log } = buildFixPlan(sheet, fixes);
    expect(log[0].cellsChanged).toBe(0);
  });

  it("'boundary' and 'missing' still emit their own distinct formulas", () => {
    const sheet = deriveSheet("Labs", [{ WBC: "<0.5" }]);
    const boundary = buildFixPlan(sheet, [{ normalizer: "censoredValues", column: "WBC", params: { policy: "boundary" } }]);
    const missing = buildFixPlan(sheet, [{ normalizer: "censoredValues", column: "WBC", params: { policy: "missing" } }]);
    expect(boundary.plan.excel_steps[0].formula).toMatch(/SUBSTITUTE/);
    expect(missing.plan.excel_steps[0].formula).toMatch(/ISNUMBER/);
  });
});
