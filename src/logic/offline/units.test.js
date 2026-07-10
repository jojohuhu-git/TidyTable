import { describe, it, expect } from "vitest";
import { inferColumnUnit, isDurationLikeColumn, formatDurationLabel } from "./units.js";

describe("units — inferColumnUnit", () => {
  it("reads an explicit days hint", () => {
    expect(inferColumnUnit("Duration_days")).toBe("days");
    expect(inferColumnUnit("LOS_days")).toBe("days");
    expect(inferColumnUnit("days_admitted")).toBe("days");
  });
  it("reads an explicit hours hint", () => {
    expect(inferColumnUnit("Wait_hours")).toBe("hours");
    expect(inferColumnUnit("Wait_hrs")).toBe("hours");
    expect(inferColumnUnit("ED_hr")).toBe("hours");
  });
  it("returns null when no unit word is present, even if it names a duration", () => {
    expect(inferColumnUnit("Duration")).toBeNull();
    expect(inferColumnUnit("LOS")).toBeNull();
  });
  it("does not false-positive on a substring (e.g. 'Holidays', 'Thursday')", () => {
    expect(inferColumnUnit("Holidays")).toBeNull();
    expect(inferColumnUnit("Thursday")).toBeNull();
  });
});

describe("units — isDurationLikeColumn", () => {
  it("treats an explicit-unit column as duration-like", () => {
    expect(isDurationLikeColumn("Duration_days")).toBe(true);
  });
  it("treats a duration-shaped name with no unit as duration-like too", () => {
    expect(isDurationLikeColumn("Duration")).toBe(true);
    expect(isDurationLikeColumn("Length_of_stay")).toBe(true);
  });
  it("does not treat an unrelated numeric column as duration-like", () => {
    expect(isDurationLikeColumn("Age")).toBe(false);
    expect(isDurationLikeColumn("Cost")).toBe(false);
  });
});

describe("units — formatDurationLabel", () => {
  it("labels the value with the explicit unit", () => {
    expect(formatDurationLabel(4.2, "Duration_days")).toEqual({ text: "4.2 days", assumptionNote: null });
  });
  it("states the assumption plainly for a duration-shaped column with no unit hint, never guessing one", () => {
    const { text, assumptionNote } = formatDurationLabel(4.2, "Duration");
    expect(text).toBe("4.2");
    expect(assumptionNote).toMatch(/doesn't say "days" or "hours"/);
  });
  it("leaves an unrelated numeric column alone, no note", () => {
    expect(formatDurationLabel(30, "Age")).toEqual({ text: "30", assumptionNote: null });
  });
  it("returns an empty label for a null value", () => {
    expect(formatDurationLabel(null, "Duration_days")).toEqual({ text: "", assumptionNote: null });
  });
});
