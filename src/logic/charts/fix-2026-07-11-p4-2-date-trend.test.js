import { describe, it, expect } from "vitest";
import { resolveChartRequest } from "./textToChart.js";
import { buildDataset } from "./aggregate.js";
import { recommendChart } from "./advisor.js";
import { excelChartSteps } from "./excelChart.js";
import { deriveSheet } from "../workbook.js";

// P4-2 (fix-2026-07-11-steps-2-3-9-plain-english.md): R8 — "trend of lab
// values over time" resolved to "count of rows across Lab_value" (nonsense)
// because nothing ever picked the date column as the grouping label for a
// trend request, and no month/quarter bucketing existed. Visit_date must
// also survive typing as "date" after the Step 2 date fix even when a
// leftover sentinel-blank ("N/A") value is still present as literal text.

function sheet() {
  return deriveSheet("Encounters", [
    { PatientID: "P1", Diagnosis: "UTI", Drug: "cephalexin", Duration_days: 10, Visit_date: "2024-01-05", Lab_value: 12.4 },
    { PatientID: "P2", Diagnosis: "pneumonia", Drug: "amoxicillin", Duration_days: 7, Visit_date: "2024-01-20", Lab_value: 9.0 },
    { PatientID: "P3", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 5, Visit_date: "2024-02-12", Lab_value: 15.1 },
    { PatientID: "P4", Diagnosis: "cystitis", Drug: "cephalexin", Duration_days: 8, Visit_date: "2024-02-18", Lab_value: 11.0 },
    { PatientID: "P5", Diagnosis: "pneumonia", Drug: "cefpodoxime", Duration_days: 6, Visit_date: "2024-04-02", Lab_value: 14.0 },
  ]);
}

describe("workbook.js inferType — date typing tolerates sentinel blanks (P4-1-adjacent, P4-2)", () => {
  it("types a column 'date' when every value is ISO or a blank sentinel", () => {
    const s = deriveSheet("S", [
      { Visit_date: "2024-01-05" },
      { Visit_date: "N/A" },
      { Visit_date: "2024-02-12" },
    ]);
    expect(s.headers.find((h) => h.name === "Visit_date").type).toBe("date");
  });

  it("does NOT type 'date' when a value is genuinely unparseable text (never silently guessed)", () => {
    const s = deriveSheet("S", [
      { Visit_date: "2024-01-05" },
      { Visit_date: "sometime in spring" },
      { Visit_date: "2024-02-12" },
    ]);
    expect(s.headers.find((h) => h.name === "Visit_date").type).toBe("text");
  });
});

describe("P4-2 — R8: 'trend of lab values over time' resolves to a date-grouped line chart", () => {
  it("R8: resolves the date column, monthly bucket, and average of the numeric column", () => {
    const res = resolveChartRequest("trend of lab values over time", sheet());
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Visit_date");
    expect(res.valueCol).toBe("Lab_value");
    expect(res.aggMode).toBe("average");
    expect(res.bucket).toBe("month");
    expect(res.lookedFor).toMatch(/grouped by month/i);
  });

  it('"average duration_days by month" buckets explicitly by month', () => {
    const res = resolveChartRequest("average duration_days by month", sheet());
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Visit_date");
    expect(res.bucket).toBe("month");
  });

  it('"average duration_days by quarter" buckets by quarter', () => {
    const res = resolveChartRequest("average duration_days by quarter", sheet());
    expect(res.status).toBe("resolved");
    expect(res.labelCol).toBe("Visit_date");
    expect(res.bucket).toBe("quarter");
  });

  it("declines honestly when there is no date column", () => {
    const noDateSheet = deriveSheet("S", [{ PatientID: "P1", Lab_value: 12.4 }, { PatientID: "P2", Lab_value: 9.0 }]);
    const res = resolveChartRequest("trend of lab values over time", noDateSheet);
    expect(res.status).toBe("none");
    expect(res.reason).toBe("no-date-column");
  });

  it("declines honestly (never guesses) when more than one date column exists", () => {
    const twoDateSheet = deriveSheet("S", [
      { Visit_date: "2024-01-05", Discharge_date: "2024-01-09", Lab_value: 12.4 },
      { Visit_date: "2024-02-12", Discharge_date: "2024-02-15", Lab_value: 9.0 },
    ]);
    const res = resolveChartRequest("trend of lab values over time", twoDateSheet);
    expect(res.status).toBe("none");
    expect(res.reason).toBe("ambiguous-date-column");
    expect(res.message).toMatch(/Visit_date/);
    expect(res.message).toMatch(/Discharge_date/);
  });
});

describe("P4-2 — aggregate.js month/quarter bucketing", () => {
  it("buildDataset groups by month when bucket: 'month'", () => {
    const ds = buildDataset(sheet(), "Visit_date", "Lab_value", { aggMode: "average", bucket: "month" });
    const labels = ds.points.map((p) => p.label).sort();
    expect(labels).toEqual(["2024-01", "2024-02", "2024-04"]);
    expect(ds.bucket).toBe("month");
    expect(ds.labelIsTime).toBe(true);
  });

  it("buildDataset groups by quarter when bucket: 'quarter'", () => {
    const ds = buildDataset(sheet(), "Visit_date", "Lab_value", { aggMode: "average", bucket: "quarter" });
    const labels = ds.points.map((p) => p.label).sort();
    // Jan+Feb -> Q1, Apr -> Q2
    expect(labels).toEqual(["2024-Q1", "2024-Q2"]);
  });

  it("sorts bucketed points chronologically, not by value", () => {
    const ds = buildDataset(sheet(), "Visit_date", "Lab_value", { aggMode: "average", bucket: "month" });
    expect(ds.points.map((p) => p.label)).toEqual(["2024-01", "2024-02", "2024-04"]);
  });

  it("skips (never guesses) a row whose date value can't be bucketed, and names it honestly", () => {
    const s = deriveSheet("S", [
      { Visit_date: "2024-01-05", Lab_value: 10 },
      { Visit_date: "unreadable date", Lab_value: 20 },
    ]);
    const ds = buildDataset(s, "Visit_date", "Lab_value", { aggMode: "average", bucket: "month" });
    expect(ds.points.map((p) => p.label)).toEqual(["2024-01"]);
    expect(ds.unbucketableValues).toEqual(["unreadable date"]);
  });

  it("the advisor recommends a line chart for a bucketed trend dataset", () => {
    const ds = buildDataset(sheet(), "Visit_date", "Lab_value", { aggMode: "average", bucket: "month" });
    expect(recommendChart(ds).type).toBe("line");
  });

  it("the Excel recipe explains how to derive the same month bucket by hand", () => {
    const ds = buildDataset(sheet(), "Visit_date", "Lab_value", { aggMode: "average", bucket: "month" });
    const steps = excelChartSteps("line", ds, {});
    const bucketStep = steps.find((s) => /group the dates/i.test(s.title));
    expect(bucketStep).toBeTruthy();
    expect(bucketStep.instruction).toMatch(/yyyy-mm/);
  });

  it("the Excel recipe uses a quarter formula for a quarter bucket", () => {
    const ds = buildDataset(sheet(), "Visit_date", "Lab_value", { aggMode: "average", bucket: "quarter" });
    const steps = excelChartSteps("line", ds, {});
    const bucketStep = steps.find((s) => /group the dates/i.test(s.title));
    expect(bucketStep.instruction).toMatch(/ROUNDUP/);
  });

  it("no bucket option leaves the pre-P4-2 one-point-per-date behavior unchanged", () => {
    const ds = buildDataset(sheet(), "Visit_date", "Lab_value", { aggMode: "average" });
    expect(ds.points.length).toBe(5);
    expect(ds.bucket).toBeUndefined();
  });
});
