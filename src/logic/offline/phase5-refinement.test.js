// @vitest-environment happy-dom
// happy-dom gives us localStorage, which missLog.js writes to (the matcher and
// refine unit tests below are environment-agnostic and pass either way).
import { describe, it, expect, beforeEach } from "vitest";
import { deriveSheet } from "../workbook.js";
import { matchRequest } from "./matcher.js";
import { startRefinement, rejectShown, pickGroup } from "./refine.js";
import { logRefinement, listMisses, clearMisses, formatMisses } from "./missLog.js";

// Phase 5 — the "no → better guess" refinement loop
// (plan-2026-07-10-offline-smarts.md). When the matcher stretches, the user can
// now say "None of these" and the loop eliminates the rejected guesses and asks
// a SMARTER next question from what remains. Honesty stance: the pool only ever
// SHRINKS — no candidate is invented mid-loop — and a lone survivor is still a
// confirm chip, never an auto-answer.

// A workbook with four numeric "duration-ish" columns, so an everyday phrase
// resolves to more candidates than round 1 can show.
function fourDurationsWb() {
  const sheet = deriveSheet("S", [
    { PatientID: "P1", Duration_days: 10, Therapy_days: 8, Course_days: 6, Stay_days: 4 },
    { PatientID: "P2", Duration_days: 7, Therapy_days: 5, Course_days: 3, Stay_days: 2 },
  ]);
  return { fileName: "x", sheets: [sheet] };
}

describe("A — matcher preserves the full ranked pool (allCandidates)", () => {
  it("allCandidates is longer than the round-1 candidates when >3 match", () => {
    const m = matchRequest("average treatment length", fourDurationsWb(), {}, {});
    expect(m.status).toBe("needs_confirm");
    expect(m.candidates.length).toBe(3); // round 1 unchanged
    expect(m.allCandidates.length).toBe(4); // full pool kept for the loop
    // The 4th (paged-out) candidate is present in the full pool only.
    const shownCols = m.candidates.map((c) => c.column);
    const allCols = m.allCandidates.map((c) => c.column);
    expect(allCols.filter((c) => !shownCols.includes(c)).length).toBe(1);
  });

  it("a single unambiguous stretch still carries allCandidates (== candidates)", () => {
    const sheet = deriveSheet("S", [
      { PatientID: "P1", Diagnosis: "UTI", Drug: "amoxicillin", Duration_days: 5 },
      { PatientID: "P2", Diagnosis: "pneumonia", Drug: "cephalexin", Duration_days: 7 },
    ]);
    const m = matchRequest("average treatment length", { fileName: "x", sheets: [sheet] }, {}, {});
    expect(m.status).toBe("needs_confirm");
    expect(m.candidates[0].column).toBe("Duration_days");
    expect(m.allCandidates.length).toBe(m.candidates.length);
  });
});

describe("B — startRefinement windows and dedupes the pool", () => {
  it("shows the first 3 as chips and keeps the rest in the pool", () => {
    const all = [
      { kind: "column", column: "A" }, { kind: "column", column: "B" },
      { kind: "column", column: "C" }, { kind: "column", column: "D" },
    ];
    const s = startRefinement({ phrase: "x", candidates: all.slice(0, 3), allCandidates: all, request: "q" });
    expect(s.shown.map((c) => c.column)).toEqual(["A", "B", "C"]);
    expect(s.pool.map((c) => c.column)).toEqual(["D"]);
    expect(s.round).toBe(1);
  });

  it("dedupes duplicate candidates (same column) before windowing", () => {
    const all = [
      { kind: "column", column: "A" }, { kind: "column", column: "A" },
      { kind: "column", column: "B" },
    ];
    const s = startRefinement({ phrase: "x", candidates: all, allCandidates: all, request: "q" });
    expect(s.shown.map((c) => c.column)).toEqual(["A", "B"]);
    expect(s.pool.length).toBe(0);
  });

  it("falls back to candidates when no allCandidates is supplied", () => {
    const c = [{ kind: "column", column: "A" }, { kind: "column", column: "B" }];
    const s = startRefinement({ phrase: "x", candidates: c, request: "q" });
    expect(s.shown.length).toBe(2);
  });
});

describe("C — chips-round elimination pages the next best guesses", () => {
  it("rejecting round 1 shows the paged-out candidate, and rejected never reappear", () => {
    const all = [
      { kind: "column", column: "A" }, { kind: "column", column: "B" },
      { kind: "column", column: "C" }, { kind: "column", column: "D" },
    ];
    const s = startRefinement({ phrase: "x", candidates: all.slice(0, 3), allCandidates: all, request: "q" });
    const step = rejectShown(s, { headers: [] });
    expect(step.done).toBe(false);
    expect(step.kind).toBe("chips");
    expect(step.options.map((c) => c.column)).toEqual(["D"]);
    // A, B, C are now rejected and can never come back.
    expect(step.state.rejected.map((c) => c.column)).toEqual(["A", "B", "C"]);
    expect(step.state.round).toBe(2);
  });

  it("a lone survivor is still a chip round, never an auto-answer", () => {
    const all = [
      { kind: "column", column: "A" }, { kind: "column", column: "B" },
      { kind: "column", column: "C" }, { kind: "column", column: "D" },
    ];
    const s = startRefinement({ phrase: "x", candidates: all.slice(0, 3), allCandidates: all, request: "q" });
    const step = rejectShown(s, { headers: [] });
    expect(step.done).toBe(false); // survivor D is shown to confirm, not answered
    expect(step.options.length).toBe(1);
  });
});

describe("D — discriminating question splits a large mixed pool", () => {
  // Seven column candidates spanning three concepts (duration / drug / diagnosis)
  // — round 1 shows 3, leaving a pool of 4 (>3), which triggers a group question.
  const mixed = [
    { kind: "column", column: "Duration_days" }, { kind: "column", column: "Therapy_days" },
    { kind: "column", column: "Course_days" }, { kind: "column", column: "Drug" },
    { kind: "column", column: "Antibiotic" }, { kind: "column", column: "Diagnosis" },
    { kind: "column", column: "Condition_code" },
  ];

  it("asks a plain-word grouping question, then pickGroup narrows to chips", () => {
    // Round 1 shows the 3 duration columns; reject → pool = [Drug, Antibiotic,
    // Diagnosis, Condition_code] spanning 2 concepts → a group question.
    const s = startRefinement({ phrase: "it", candidates: mixed.slice(0, 3), allCandidates: mixed, request: "q" });
    const step = rejectShown(s, { headers: [] });
    expect(step.kind).toBe("group");
    expect(step.question).toMatch(/the drug given|the diagnosis/i);
    expect(step.groups.length).toBeGreaterThanOrEqual(2);
    // Pick the diagnosis group → its members become chips.
    const dxGroup = step.groups.find((g) => g.key === "diagnosis");
    expect(dxGroup).toBeTruthy();
    const picked = pickGroup(step.state, "diagnosis", step.groups);
    expect(picked.kind).toBe("chips");
    expect(picked.options.every((c) => ["Diagnosis", "Condition_code"].includes(c.column))).toBe(true);
  });

  it("groups value candidates by their column", () => {
    const values = [
      { column: "Drug", value: "amoxicillin" }, { column: "Drug", value: "amoxil" },
      { column: "Drug", value: "amox" }, { column: "Drug", value: "amoxi" },
      { column: "Notes", value: "amoxicillin given" }, { column: "Notes", value: "amox started" },
      { column: "Notes", value: "amox dose" },
    ];
    const s = startRefinement({ phrase: "amox", candidates: values.slice(0, 3), allCandidates: values, request: "q" });
    const step = rejectShown(s, { headers: [] });
    expect(step.kind).toBe("group");
    expect(step.question).toMatch(/"Drug" column|"Notes" column/);
  });
});

describe("E — one-group fallback pages instead of asking a pointless question", () => {
  it("a large pool that is all one concept just pages the next chips", () => {
    const all = [
      { kind: "column", column: "Duration_days" }, { kind: "column", column: "Therapy_days" },
      { kind: "column", column: "Course_days" }, { kind: "column", column: "Stay_days" },
      { kind: "column", column: "Los_days" }, { kind: "column", column: "Time_days" },
    ];
    const s = startRefinement({ phrase: "x", candidates: all.slice(0, 3), allCandidates: all, request: "q" });
    const step = rejectShown(s, { headers: [] });
    expect(step.kind).toBe("chips"); // one concept → no group question
    expect(step.options.length).toBe(3);
  });
});

describe("F — exhaustion and the round cap end the loop honestly", () => {
  it("rejecting until the pool is empty returns done: exhausted", () => {
    const all = [{ kind: "column", column: "A" }, { kind: "column", column: "B" }];
    const s = startRefinement({ phrase: "x", candidates: all, allCandidates: all, request: "q" });
    const step = rejectShown(s, { headers: [] });
    expect(step.done).toBe(true);
    expect(step.outcome).toBe("exhausted");
    expect(step.state.rejected.map((c) => c.column)).toEqual(["A", "B"]);
  });

  it("a group round is escapable — 'None of these' there also exhausts", () => {
    const mixed = [
      { kind: "column", column: "Duration_days" }, { kind: "column", column: "Therapy_days" },
      { kind: "column", column: "Course_days" }, { kind: "column", column: "Drug" },
      { kind: "column", column: "Antibiotic" }, { kind: "column", column: "Diagnosis" },
      { kind: "column", column: "Condition_code" },
    ];
    const s = startRefinement({ phrase: "it", candidates: mixed.slice(0, 3), allCandidates: mixed, request: "q" });
    const group = rejectShown(s, { headers: [] });
    expect(group.kind).toBe("group");
    // Rejecting the whole group question rejects the remaining pool → exhausted.
    const done = rejectShown(group.state, { headers: [] });
    expect(done.done).toBe(true);
    expect(done.outcome).toBe("exhausted");
  });
});

describe("G — miss log: round count + privacy", () => {
  beforeEach(() => clearMisses());

  it("logs a >1-round success with its round count, rendered in the export", () => {
    logRefinement({
      request: "average treatment length", phrase: "treatment length", rounds: 2,
      outcome: "refined-success", rejectedColumns: ["Therapy_days"],
    });
    const list = listMisses();
    expect(list.length).toBe(1);
    expect(list[0].reason).toBe("refined-success");
    expect(list[0].detail.rounds).toBe(2);
    expect(formatMisses()).toMatch(/refined-success, 2 rounds/);
  });

  it("records COLUMN names only for rejected VALUE candidates — never a cell value", () => {
    // Simulate the App wiring: a rejected value candidate contributes only its
    // column name, mirroring the Phase 3 alias-store privacy boundary.
    const rejectedValueCands = [
      { column: "Drug", value: "amoxicillin" },
      { column: "Diagnosis", value: "UTI" },
    ];
    logRefinement({
      request: "the amox one", phrase: "amox", rounds: 3, outcome: "refined-exhausted",
      rejectedColumns: rejectedValueCands.map((c) => c.column),
    });
    const dump = JSON.stringify(listMisses());
    for (const secret of ["amoxicillin", "UTI"]) expect(dump).not.toContain(secret);
    expect(dump).toContain("Drug"); // column names are fine to store
    expect(dump).toContain("Diagnosis");
  });

  it("dedupes rejected column names", () => {
    logRefinement({
      request: "q", phrase: "p", rounds: 2, outcome: "refined-success",
      rejectedColumns: ["A", "A", "B", null, "B"],
    });
    expect(listMisses()[0].detail.rejectedColumns).toEqual(["A", "B"]);
  });

  it("P4-6: stores the honest message text alongside the reason, for the 'couldn't answer' list", () => {
    logRefinement({
      request: "the amox one", phrase: "amox", rounds: 2, outcome: "refined-exhausted",
      rejectedColumns: ["Drug"], message: "I showed you every guess I had for \"amox\" and none of them fit.",
    });
    expect(listMisses()[0].message).toBe("I showed you every guess I had for \"amox\" and none of them fit.");
  });
});

describe("H — cleanCondition strips allCandidates so executed plans stay identical", () => {
  it("no allCandidates leaks into a confident answer's executed plan", () => {
    // A plain exact request answers with no stretch annotations at all.
    const sheet = deriveSheet("S", [
      { PatientID: "P1", Diagnosis: "UTI", Duration_days: 5 },
      { PatientID: "P2", Diagnosis: "pneumonia", Duration_days: 7 },
    ]);
    const m = matchRequest("average Duration_days", { fileName: "x", sheets: [sheet] }, {}, {});
    expect(m.status).toBe("confident");
    const serialized = JSON.stringify(m);
    expect(serialized).not.toContain("allCandidates");
  });
});
