import { describe, it, expect } from "vitest";
import { fakeValue, fakeSamples, fakeStream } from "./synthetic.js";

describe("fakeValue", () => {
  it("preserves null", () => {
    expect(fakeValue(null, fakeStream())).toBe(null);
  });

  it("keeps booleans as-is", () => {
    expect(fakeValue(true, fakeStream())).toBe(true);
    expect(fakeValue(false, fakeStream())).toBe(false);
  });

  it("preserves text shape but not content", () => {
    const out = fakeValue("Dr. Smith", fakeStream());
    expect(out).toHaveLength("Dr. Smith".length);
    expect(out).not.toBe("Dr. Smith");
    // Letters stay letters, the ". " layout is preserved.
    expect(out).toMatch(/^[A-Za-z][a-z]\. [A-Za-z][a-z]{4}$/);
  });

  it("preserves digit runs and separators in ID-like text", () => {
    const out = fakeValue("MRN-00042", fakeStream());
    expect(out).toMatch(/^[A-Z]{3}-\d{5}$/);
    expect(out).not.toBe("MRN-00042");
  });

  it("keeps a date in ISO format and in a neutral range", () => {
    const out = fakeValue("1961-08-14", fakeStream());
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).not.toBe("1961-08-14");
  });

  it("keeps the time part of a datetime", () => {
    const out = fakeValue("2024-03-15 09:30", fakeStream());
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("keeps a number's whole/decimal digit counts", () => {
    const out = fakeValue(1204, fakeStream());
    expect(Number.isInteger(out)).toBe(true);
    expect(String(out)).toHaveLength(4);
  });

  it("keeps decimal places and sign", () => {
    const out = fakeValue(-0.75, fakeStream());
    expect(out).toBeLessThan(0);
    expect(String(Math.abs(out))).toMatch(/^\d\.\d{2}$/);
  });

  it("is stable for a given seed", () => {
    expect(fakeValue("Alice", fakeStream(42))).toBe(fakeValue("Alice", fakeStream(42)));
  });

  it("does not encode equality of inputs (two same inputs -> different fakes in one stream)", () => {
    const rng = fakeStream(3);
    const a = fakeValue("Smith", rng);
    const b = fakeValue("Smith", rng);
    expect(a).not.toBe(b);
  });
});

describe("fakeSamples", () => {
  it("returns one fake per input", () => {
    const out = fakeSamples(["West", "East", "north"]);
    expect(out).toHaveLength(3);
    out.forEach((v, i) => expect(v).toHaveLength(["West", "East", "north"][i].length));
  });
});
