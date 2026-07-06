import { describe, it, expect } from "vitest";
import {
  antiJoin, leftJoinLookup, explodePairedLists, asOfJoin, reshapeLongToWide, reshapeWideToLong,
} from "./shelf.js";

describe("anti-join", () => {
  it("keeps A rows whose key is absent from B", () => {
    const a = [{ id: "P1" }, { id: "P2" }, { id: "P3" }];
    const b = [{ id: "P2" }];
    expect(antiJoin(a, b, "id").map((r) => r.id)).toEqual(["P1", "P3"]);
  });
});

describe("left-join lookup (drug → class dictionary)", () => {
  it("brings the class onto each row and reports unmatched", () => {
    const scripts = [{ Drug: "amox" }, { Drug: "cipro" }, { Drug: "mystery" }];
    const dict = [{ Drug: "amox", Class: "beta-lactam" }, { Drug: "cipro", Class: "fluoroquinolone" }];
    const { rows, unmatched } = leftJoinLookup(scripts, dict, "Drug", ["Class"]);
    expect(rows[0].Class).toBe("beta-lactam");
    expect(rows[2].Class).toBe(null);
    expect(unmatched.map((r) => r.Drug)).toEqual(["mystery"]);
  });
});

describe("explode paired lists", () => {
  it("splits equal-length pairs into one row each", () => {
    const { rows, mismatched } = explodePairedLists([{ Drug: "a, b", Dose: "1, 2" }], "Drug", "Dose");
    expect(rows).toEqual([{ Drug: "a", Dose: "1" }, { Drug: "b", Dose: "2" }]);
    expect(mismatched).toHaveLength(0);
  });
  it("refuses to guess when the two lists differ in length", () => {
    const { rows, mismatched } = explodePairedLists([{ Drug: "a, b, c", Dose: "1, 2" }], "Drug", "Dose");
    expect(rows).toHaveLength(0);
    expect(mismatched).toHaveLength(1);
  });
});

describe("as-of join", () => {
  it("matches each event to the most recent prior at or before its time, flags none-found", () => {
    const events = [
      { pid: "P1", date: "2024-03-10" },
      { pid: "P1", date: "2024-01-05" }, // before any prior
    ];
    const priors = [
      { pid: "P1", date: "2024-02-01", Lab: 10 },
      { pid: "P1", date: "2024-03-01", Lab: 20 },
    ];
    const { rows, unmatched } = asOfJoin(events, priors, "pid", "date", ["Lab"]);
    expect(rows[0].prior_Lab).toBe(20); // most recent at/before Mar 10
    expect(rows[1].prior_Lab).toBe(null); // nothing on/before Jan 5
    expect(unmatched).toHaveLength(1);
  });
});

describe("reshape", () => {
  it("long → wide spreads measures into columns per id", () => {
    const rows = [
      { pid: "P1", test: "Na", val: 140 },
      { pid: "P1", test: "K", val: 4 },
      { pid: "P2", test: "Na", val: 138 },
    ];
    const { rows: wide, columns } = reshapeLongToWide(rows, "pid", "test", "val");
    expect(columns).toEqual(["pid", "Na", "K"]);
    expect(wide[0]).toEqual({ pid: "P1", Na: 140, K: 4 });
  });
  it("wide → long turns value columns into rows and drops blanks", () => {
    const long = reshapeWideToLong([{ pid: "P1", Na: 140, K: null }], "pid", ["Na", "K"]);
    expect(long).toEqual([{ pid: "P1", measure: "Na", value: 140 }]);
  });
});
