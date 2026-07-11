// @vitest-environment happy-dom
// Phase 7.5 (plan-2026-07-10-offline-smarts.md) — the Table-1 builder.
// Publication-style descriptive table: n (%) per category level, median (IQR) +
// mean (SD) for numerics, missing counts per column. Standard biostatistics
// conventions, offline and deterministic.

import { describe, it, expect } from "vitest";
import { matchRequest } from "./matcher.js";
import { runOffline } from "./runOffline.js";
import { buildExampleWorkbook } from "../exampleWorkbook.js";

describe("Phase 7.5 — Table-1 detection", () => {
  it("'summarize diagnosis, drug and duration' names 3 columns → a Table-1", () => {
    const m = matchRequest("summarize diagnosis, drug and duration", buildExampleWorkbook(), { present: false });
    expect(m.status).toBe("confident");
    expect(m.intent).toBe("table1");
    expect(m.table1.columns).toEqual(["Diagnosis", "Drug", "Duration_days"]);
  });

  it("a bare column list (no operation) is a Table-1 too", () => {
    const m = matchRequest("diagnosis, drug and duration", buildExampleWorkbook(), { present: false });
    expect(m.status).toBe("confident");
    expect(m.intent).toBe("table1");
  });

  it("a single-column 'summarize duration' stays a describe, not a Table-1", () => {
    const m = matchRequest("summarize duration_days", buildExampleWorkbook(), { present: false });
    expect(m.intent).toBe("describe");
  });

  it("a filtered/counting request is never a Table-1", () => {
    const m = matchRequest("how many records with UTI", buildExampleWorkbook(), { present: false });
    expect(m.intent).not.toBe("table1");
  });
});

describe("Phase 7.5 — Table-1 result rows", () => {
  const res = runOffline("summarize diagnosis, drug and duration", buildExampleWorkbook(), {});

  it("answers with a Table-1 result", () => {
    expect(res.kind).toBe("answer");
  });

  it("reports each category level as n (%) over the non-missing denominator", () => {
    const rows = res.resultRows;
    const uti = rows.find((r) => r.Characteristic.trim() === "UTI");
    expect(uti.Summary).toBe("2 (33.3%)");
    const dxHeader = rows.find((r) => r.Characteristic === "Diagnosis — n (%)");
    expect(dxHeader.Missing).toBe(0);
  });

  it("reports the numeric column as median (IQR) + mean (SD) with a missing count", () => {
    const dur = res.resultRows.find((r) => r.Characteristic === "Duration_days");
    expect(dur.Summary).toMatch(/median 6 days \(IQR 5–7\.75\); mean 6\.75 \(SD/);
    expect(dur.Missing).toBe(2); // two "N/A" cells
  });
});

describe("Phase 7.5 — the worker transform reproduces the same table", () => {
  it("re-running the generated transform yields identical result rows", () => {
    const wb = buildExampleWorkbook();
    const res = runOffline("summarize diagnosis, drug and duration", wb, {});
    const sheetsByName = Object.fromEntries(wb.sheets.map((s) => [s.name, s.rows]));
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", res.plan.transform_code);
    expect(fn(sheetsByName)).toEqual(res.resultRows);
  });
});
