// @vitest-environment happy-dom
// happy-dom gives us localStorage, which the hit and graduation stores persist
// to. This is the store-persistence + end-to-end layer for Phase 6; the pure
// shape/reconstruction logic is in src/logic/offline/phase6-graduation.test.js.
import { describe, it, expect, beforeEach } from "vitest";
import { runOffline } from "../src/logic/offline/runOffline.js";
import { matchRequest } from "../src/logic/offline/matcher.js";
import { detectIntent, detectTopN } from "../src/logic/offline/synonyms.js";
import { buildExampleWorkbook } from "../src/logic/exampleWorkbook.js";
import { fileSignature } from "../src/logic/offline/aliasStore.js";
import { planShapeFromMatch, planShapeFromAiPlan } from "../src/logic/offline/planShape.js";
import {
  emptyGraduationStore, rememberGraduation, persistGraduationStore, loadGraduationStore,
} from "../src/logic/offline/graduationStore.js";
import {
  logHit, listHits, clearHits, formatHits, exportBankCandidates,
} from "../src/logic/offline/hitStore.js";

const wb = () => buildExampleWorkbook();
const sig = () => fileSignature(wb().sheets[0].headers);

beforeEach(() => {
  localStorage.clear();
  clearHits();
});

describe("graduation store — localStorage round-trip", () => {
  it("persists and reloads a remembered shape byte-for-byte", () => {
    const shape = planShapeFromMatch(matchRequest("average duration_days", wb(), {}, {}));
    let store = rememberGraduation(emptyGraduationStore(), sig(), "average treatment window", shape);
    persistGraduationStore(store);
    const reloaded = loadGraduationStore();
    expect(reloaded.files[sig()]).toBeTruthy();
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(store));
  });
});

describe("AI graduation, end-to-end through runOffline", () => {
  it("a phrasing the matcher DECLINES is answered offline after graduation", () => {
    // 1. Baseline: the offline engine genuinely can't place this wording.
    const before = runOffline("average treatment window", wb());
    expect(before.kind).toBe("decline");

    // 2. Claude answers it once; we capture the value-free shape it used.
    const headers = wb().sheets[0].headers;
    const aiPlan = {
      summary: "Average of Duration_days across all rows.",
      transform_code: "return [{ avg: rows.reduce((a,r)=>a+Number(r['Duration_days']||0),0) }];",
      excel_steps: [{ title: "Average", instruction: "=AVERAGE of the Duration_days column" }],
    };
    const shape = planShapeFromAiPlan({ request: "average treatment window", plan: aiPlan, headers, detectIntent, detectTopN });
    const store = rememberGraduation(emptyGraduationStore(), sig(), "average treatment window", shape);

    // 3. The SAME wording now answers offline, with no API key.
    const after = runOffline("average treatment window", wb(), { graduationStore: store });
    expect(after.kind).toBe("answer");
    expect(after.graduated).toBe(true);
    expect(after.match.aggregation.targetColumn).toBe("Duration_days");
    expect(after.lookedFor).toMatch(/Averaging "Duration_days"/);
  });

  it("graduation never overrides a request the matcher can already answer", () => {
    const store = rememberGraduation(emptyGraduationStore(), sig(), "average duration_days", { intent: "average", target: "Lab_value", columns: ["Lab_value"] });
    // The matcher answers this itself (Duration_days) and never consults the
    // graduation store, so the bogus remembered target can't hijack it.
    const res = runOffline("average duration_days", wb(), { graduationStore: store });
    expect(res.kind).toBe("answer");
    expect(res.match.aggregation.targetColumn).toBe("Duration_days");
  });
});

describe("hit store — mirror of missLog for accepted answers", () => {
  it("records a request + value-free shape and exports it", () => {
    const shape = planShapeFromMatch(matchRequest("average duration_days for patients with UTI", wb(), {}, {}));
    logHit({ request: "average duration_days for patients with UTI", shape });
    const list = listHits();
    expect(list.length).toBe(1);
    expect(list[0].request).toBe("average duration_days for patients with UTI");
    // PRIVACY: the persisted SHAPE (the part derived from the DATA) carries the
    // filter's column but never its cell value "UTI". The `request` field is the
    // user's own typed words, like missLog — not a value read out of the sheet.
    expect(JSON.stringify(list[0].shape)).not.toContain("UTI");
    expect(JSON.stringify(list[0].shape)).toContain("Diagnosis");
    expect(formatHits()).toMatch(/average of Duration_days/);
  });

  it("exportBankCandidates de-duplicates identical request+shape pairs", () => {
    const shape = planShapeFromMatch(matchRequest("most common drug", wb(), {}, {}));
    logHit({ request: "which drug is used most", shape });
    logHit({ request: "which drug is used most", shape });
    const candidates = exportBankCandidates();
    expect(candidates.length).toBe(1);
    expect(candidates[0].phrasing).toBe("which drug is used most");
    expect(JSON.stringify(candidates)).not.toContain("amoxicillin");
  });
});
