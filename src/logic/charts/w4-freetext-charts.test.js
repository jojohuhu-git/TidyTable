import { describe, it, expect } from "vitest";
import { deriveSheet } from "../workbook.js";
import { resolveChartRequest } from "./textToChart.js";
import { buildDataset, groupSmallIntoOther } from "./aggregate.js";
import { recommendChart } from "./advisor.js";
import { excelChartSteps } from "./excelChart.js";
import { chartPalette, OKABE_ITO, isQualitative } from "./palette.js";

// W4: describe the chart in words; the app designs it. The parser reuses the
// W2 matcher primitives, so "e coli" and "in urine" resolve the same way they
// do in Step 3 — but flagged as a stretch so the UI confirms before drawing.

function clinicalSheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", "Urine Organisms": "ESCHERICHIA COLI", Ward: "ICU", Duration_days: 5, Cost: 100 },
    { PatientID: "P2", "Urine Organisms": "KLEBSIELLA PNEUMONIAE", Ward: "General", Duration_days: 3, Cost: 200 },
    { PatientID: "P3", "Urine Organisms": "ESCHERICHIA COLI", Ward: "General", Duration_days: 7, Cost: 150 },
    { PatientID: "P4", "Urine Organisms": "PSEUDOMONAS AERUGINOSA", Ward: "ICU", Duration_days: 2, Cost: 80 },
  ]);
}

describe("W4 text→chart resolution table", () => {
  const sheet = clinicalSheet();
  const cases = [
    {
      text: "organisms in urine by number of patients",
      expect: { labelCol: "Urine Organisms", valueCol: null, aggMode: "count", confidence: "exact" },
    },
    {
      text: "average duration_days by ward",
      expect: { labelCol: "Ward", valueCol: "Duration_days", aggMode: "average", confidence: "exact" },
    },
    {
      text: "total cost by ward",
      expect: { labelCol: "Ward", valueCol: "Cost", aggMode: "sum", confidence: "exact" },
    },
    {
      text: "patients by ward",
      expect: { labelCol: "Ward", valueCol: null, aggMode: "count", confidence: "exact" },
    },
  ];

  for (const c of cases) {
    it(`resolves "${c.text}"`, () => {
      const res = resolveChartRequest(c.text, sheet);
      expect(res.status).toBe("resolved");
      expect(res.labelCol).toBe(c.expect.labelCol);
      expect(res.valueCol).toBe(c.expect.valueCol);
      expect(res.aggMode).toBe(c.expect.aggMode);
      expect(res.confidence).toBe(c.expect.confidence);
    });
  }

  it("scopes a value filter: 'escherichia coli by ward' filters rows, exact", () => {
    const res = resolveChartRequest("escherichia coli by ward", sheet);
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Ward");
    expect(res.filter).toEqual({ column: "Urine Organisms", value: "ESCHERICHIA COLI" });
    expect(res.confidence).toBe("exact");
  });

  it("an abbreviation is a stretch to confirm: 'e coli by ward'", () => {
    const res = resolveChartRequest("e coli by ward", sheet);
    expect(res.status).toBe("resolved");
    expect(res.filter).toEqual({ column: "Urine Organisms", value: "ESCHERICHIA COLI" });
    expect(res.confidence).toBe("stretched");
  });

  it("declines plainly when no column can be found, never guessing", () => {
    const res = resolveChartRequest("asdkjaslkdjas nothing here", sheet);
    expect(res.status).toBe("none");
    expect(res.message).toMatch(/couldn't tell which column/i);
  });

  it("declines an average with no numeric column to average", () => {
    const res = resolveChartRequest("average organisms by ward", sheet);
    expect(res.status).toBe("none");
    expect(res.message).toMatch(/no numeric column/i);
  });

  it("the resolved filter carries into the dataset — identical numbers by hand", () => {
    const res = resolveChartRequest("escherichia coli by ward", sheet);
    const ds = buildDataset(sheet, res.labelCol, res.valueCol, { aggMode: res.aggMode, filter: res.filter });
    // Two E. coli rows: one ICU, one General.
    const byLabel = Object.fromEntries(ds.points.map((p) => [p.label, p.value]));
    expect(byLabel).toEqual({ ICU: 1, General: 1 });
  });

  it("average is a true mean per group, not a running total", () => {
    const res = resolveChartRequest("average duration_days by ward", sheet);
    const ds = buildDataset(sheet, res.labelCol, res.valueCol, { aggMode: res.aggMode });
    const byLabel = Object.fromEntries(ds.points.map((p) => [p.label, p.value]));
    // ICU: (5+2)/2 = 3.5 ; General: (3+7)/2 = 5
    expect(byLabel).toEqual({ ICU: 3.5, General: 5 });
  });
});

describe("W4 advisor layout intelligence — many categories go horizontal, never refuse", () => {
  const cat = (n) => ({ kind: "categorical", points: Array.from({ length: n }, (_, i) => ({ label: "c" + i, value: n - i })) });

  it("recommends a horizontal bar for many categories, drawing all of them", () => {
    const rec = recommendChart(cat(40));
    expect(rec.type).toBe("bar");
    expect(rec.layout).toBe("horizontal");
    expect(rec.reason).toMatch(/40 categories/);
    expect(rec.offerGroupOther).toBe(true);
  });

  it("still uses a vertical bar for a modest number of categories", () => {
    const rec = recommendChart(cat(6));
    expect(rec.type).toBe("bar");
    expect(rec.layout).toBeUndefined();
  });

  it("never returns type 'none' for a large categorical set", () => {
    expect(recommendChart(cat(500)).type).toBe("bar");
  });
});

describe("W4 groupSmallIntoOther is offered, reversible, and honest", () => {
  it("folds sub-threshold categories into one 'Other' bar and leaves the rest", () => {
    const ds = {
      kind: "categorical", labelIsTime: false,
      points: [{ label: "Big", value: 90 }, { label: "Mid", value: 8 }, { label: "Tiny1", value: 1 }, { label: "Tiny2", value: 1 }],
    };
    const grouped = groupSmallIntoOther(ds, 2);
    const other = grouped.points.find((p) => /Other/.test(p.label));
    expect(other).toBeTruthy();
    expect(other.value).toBe(2); // 1 + 1
    expect(grouped.points.some((p) => p.label === "Big")).toBe(true);
    // Total is preserved — nothing dropped.
    const total = grouped.points.reduce((s, p) => s + p.value, 0);
    expect(total).toBe(100);
  });

  it("does nothing for a time series (grouping months into 'Other' would lie)", () => {
    const ds = { kind: "categorical", labelIsTime: true, points: [{ label: "Jan", value: 1 }, { label: "Feb", value: 99 }] };
    expect(groupSmallIntoOther(ds, 2)).toBe(ds);
  });
});

describe("W4 palette", () => {
  it("uses the Okabe-Ito colorblind-safe palette for a short list", () => {
    expect(chartPalette(3)).toEqual(OKABE_ITO.slice(0, 3));
    expect(chartPalette(8)).toEqual(OKABE_ITO);
    expect(isQualitative(8)).toBe(true);
    expect(isQualitative(9)).toBe(false);
  });

  it("uses a single-hue ramp of distinct valid hexes for a long list", () => {
    const p = chartPalette(40);
    expect(p).toHaveLength(40);
    expect(p.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
    expect(new Set(p).size).toBe(40); // all distinct
    // Top 3 emphasized: the darkest shades sit first (largest bars).
    expect(p[0]).toBe("#0e6b63");
  });

  it("returns an empty palette for no categories", () => {
    expect(chartPalette(0)).toEqual([]);
  });
});

describe("W4 excel steps reproduce the preview — horizontal bar case", () => {
  const sheet = deriveSheet("D", Array.from({ length: 40 }, (_, i) => ({ Ward: `Ward ${i}`, Cost: i + 1 })));
  const ds = buildDataset(sheet, "Ward", "Cost"); // total Cost per Ward, so values differ and sort
  const rec = recommendChart(ds);
  const steps = excelChartSteps("bar", ds, rec);
  const blob = steps.map((s) => `${s.title} ${s.instruction}`).join("\n");

  it("names Excel's 'Bar' (horizontal) vs 'Column' (vertical) distinction", () => {
    expect(blob).toMatch(/\bBar\b/);
    expect(blob).toMatch(/Column/);
  });
  it("includes a sort step keeping largest first", () => {
    expect(blob).toMatch(/largest to smallest|largest first/i);
    expect(steps.some((s) => /sort/i.test(s.title))).toBe(true);
  });
  it("includes an exact helper aggregation table with real rows", () => {
    expect(steps.some((s) => /helper table/i.test(s.title))).toBe(true);
    expect(blob).toMatch(/Ward 39 — 40/); // largest row spelled out
  });
  it("notes applying the same colors", () => {
    expect(blob).toMatch(/color/i);
  });
});

describe("W4 excel steps for a filtered chart mention the filter", () => {
  const sheet = clinicalSheet();
  const res = resolveChartRequest("escherichia coli by ward", sheet);
  const ds = buildDataset(sheet, res.labelCol, res.valueCol, { aggMode: res.aggMode, filter: res.filter });
  const steps = excelChartSteps("bar", ds, recommendChart(ds));
  it("tells the user the chart is filtered so Excel matches", () => {
    const blob = steps.map((s) => s.instruction).join("\n");
    expect(blob).toMatch(/Urine Organisms.*ESCHERICHIA COLI/);
  });
});
