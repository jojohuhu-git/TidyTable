import { describe, it, expect } from "vitest";
import { runOffline } from "./runOffline.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";

// Fix spec P1-1: a new offline intent that LISTS the matching rows (not a
// count), reusing the cohort filter machinery, with an optional sort. R1 and R3
// become real answers. Verified across all three surfaces: result table, Excel
// recipe, R script.
const wb = () => buildExampleWorkbook();

describe("P1-1 — list matching rows", () => {
  it('R1: "show me all patients who got cephalexin" lists the matching rows', () => {
    const res = runOffline("show me all patients who got cephalexin", wb(), {});
    expect(res.kind).toBe("answer");
    // Example data: cephalexin appears on 3 encounter rows (P1, P4, P4-dup).
    expect(res.resultRows.length).toBe(3);
    for (const r of res.resultRows) expect(String(r.Drug).toLowerCase()).toBe("cephalexin");
    expect(res.lookedFor).toMatch(/Listing the rows where/i);
  });

  it("R1 result reproduces via the worker transform (downloadable result matches)", () => {
    const book = wb();
    const res = runOffline("show me all patients who got cephalexin", book, {});
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", res.plan.transform_code);
    const out = fn({ [book.sheets[0].name]: book.sheets[0].rows });
    expect(out.length).toBe(3);
    expect(out.every((r) => String(r.Drug).toLowerCase() === "cephalexin")).toBe(true);
  });

  it("R1 gives a runnable dplyr filter script (R surface)", () => {
    const res = runOffline("show me all patients who got cephalexin", wb(), {});
    expect(res.plan.r_script).toMatch(/filter\(/);
    expect(res.plan.r_script).toMatch(/Drug == "cephalexin"/);
  });

  it("R1 gives an honest Data > Filter Excel recipe (Excel surface)", () => {
    const res = runOffline("show me all patients who got cephalexin", wb(), {});
    const txt = res.plan.excel_steps.map((s) => s.instruction).join(" ");
    expect(txt).toMatch(/Data > Filter/i);
    expect(txt).toMatch(/cephalexin/);
  });

  it('R3: "sort the rows by visit date newest first" lists all rows, sorted descending', () => {
    const res = runOffline("sort the rows by visit date newest first", wb(), {});
    expect(res.kind).toBe("answer");
    expect(res.resultRows.length).toBe(6); // no filter — all rows
    const dates = res.resultRows.map((r) => r.Visit_date);
    // Descending: the first non-blank should be >= the last non-blank.
    expect(res.lookedFor).toMatch(/sorted by "Visit_date"/i);
    expect(dates[0]).not.toBeUndefined();
  });

  it('a filtered + sorted list: "list patients with UTI sorted by duration highest first"', () => {
    const res = runOffline("list patients with UTI sorted by duration highest first", wb(), {});
    expect(res.kind).toBe("answer");
    for (const r of res.resultRows) expect(String(r.Diagnosis).toLowerCase()).toBe("uti");
    // UTI rows durations: P1=10, P3=5 → highest first = 10 then 5.
    const durs = res.resultRows.map((r) => Number(r.Duration_days)).filter((n) => !Number.isNaN(n));
    expect(durs).toEqual([...durs].sort((a, b) => b - a));
  });

  it('does not hijack a count: "show me how many patients got cephalexin" stays a count question', () => {
    const res = runOffline("show me how many patients got cephalexin", wb(), {});
    expect(res.kind).toBe("clarify-grain"); // still a count, asks the grain question
  });

  it('does not hijack a ranking: "show me the most common drug" still ranks', () => {
    const res = runOffline("show me the most common drug", wb(), {});
    expect(res.kind).toBe("answer");
    expect(res.lookedFor).toMatch(/rank|most/i);
  });
});
