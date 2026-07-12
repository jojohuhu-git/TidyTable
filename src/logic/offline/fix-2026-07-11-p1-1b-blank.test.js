import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";

// Fix spec P1-1b (deferred out of P1-1): a new "missing / blank / empty" filter
// primitive so R5 — "show me the rows where lab value is missing" — becomes a
// real answer instead of an "I can't pull out rows" decline. "Missing" means the
// SAME sentinel set Step 2's cleanup already recognizes (null, "", N/A, none, -,
// .), so the whole app agrees on what "no value" is. Verified across every
// surface: result table, worker transform (the download), Excel recipe, R script,
// and — for parity — the count intent, not just list.
const wb = () => buildExampleWorkbook();

// Example data Lab_value column: "12.4", "<0.5", "9.8", "N/A", "N/A", "15.1".
// Missing = the two "N/A" rows (a censored "<0.5" is a real result, NOT missing).
describe("P1-1b — missing / blank / empty filter", () => {
  it('R5: "show me the rows where lab value is missing" lists the missing-value rows', () => {
    const res = runOffline("show me the rows where lab value is missing", wb(), {});
    expect(res.kind).toBe("answer");
    // The two N/A rows — not zero (a naive null-only check would miss them).
    expect(res.resultRows.length).toBe(2);
    for (const r of res.resultRows) {
      const v = String(r.Lab_value ?? "").trim().toLowerCase();
      expect(["", "n/a", "na", "none", "-", "."]).toContain(v);
    }
  });

  it("a censored below-limit value is NOT treated as missing", () => {
    const res = runOffline("list the rows where lab value is missing", wb(), {});
    expect(res.resultRows.some((r) => String(r.Lab_value) === "<0.5")).toBe(false);
  });

  it('"present" is the honest opposite: rows where lab value IS recorded', () => {
    const res = runOffline("show me the rows where lab value is present", wb(), {});
    expect(res.kind).toBe("answer");
    expect(res.resultRows.length).toBe(4); // 6 total − 2 N/A
    for (const r of res.resultRows) {
      const v = String(r.Lab_value ?? "").trim().toLowerCase();
      expect(["", "n/a", "na", "none", "-", "."]).not.toContain(v);
    }
  });

  it("worker transform reproduces the missing-row list (the download matches)", () => {
    const book = wb();
    const res = runOffline("show me the rows where lab value is missing", book, {});
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", res.plan.transform_code);
    const out = fn({ [book.sheets[0].name]: book.sheets[0].rows });
    expect(out.length).toBe(2);
    expect(out.every((r) => String(r.Lab_value).toLowerCase() === "n/a")).toBe(true);
  });

  it("R script filters on missing values (is.na + sentinel set)", () => {
    const res = runOffline("show me the rows where lab value is missing", wb(), {});
    expect(res.plan.r_script).toMatch(/is\.na\(Lab_value\)/);
    expect(res.plan.r_script.toLowerCase()).toMatch(/n\/a/);
  });

  it("Excel recipe tells the user to filter to blanks/missing markers", () => {
    const res = runOffline("show me the rows where lab value is missing", wb(), {});
    const txt = res.plan.excel_steps.map((s) => s.instruction).join(" ").toLowerCase();
    expect(txt).toMatch(/blank|missing/);
    expect(txt).toMatch(/lab_value/i);
  });

  it("parity: the same filter works in the COUNT intent, not just list", () => {
    const res = runOffline("how many rows have lab value missing", wb(), {});
    expect(res.kind).toBe("answer");
    expect(res.exec.levels[0].count).toBe(2);
  });
});
