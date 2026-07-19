// P2-3 (spec: fix-2026-07-11-steps-2-3-9-plain-english.md): map a plain-English
// request typed into Step 2's "Or tell me what to clean…" box onto findings the
// checkup scan ALREADY found for this file. Nothing new is computed here — a
// match only points at an existing finding.id; the caller still runs the same
// select/apply path a manual tick would, so this can never corrupt data. Never
// guess: when a request could mean more than one column and none is named, it
// is reported as ambiguous rather than picked for the user.

import { columnKey } from "../recipes/recipe.js";

const INTENTS = [
  { name: "duplicates", re: /\bduplicat/i, types: ["duplicateRows", "duplicateIds", "duplicateEncounterIds", "duplicatePatientIds"] },
  { name: "dates", re: /\bdates?\b/i, types: ["textDates", "epochDates"] },
  { name: "missing", re: /\b(n\/?a|blanks?|missing)\b/i, types: ["missing"] },
  { name: "variants", re: /\b(spelling|variant)/i, types: ["categoryVariants"] },
];

const NOT_FOUND_MESSAGE = {
  duplicates: "No duplicate rows were found in this sheet.",
  dates: "No date-formatting issues were found in this sheet.",
  missing: "No missing or blank values were found in this sheet.",
  variants: "No spelling-variant categories were found in this sheet.",
};

function columnNamedInRequest(column, reqKey) {
  const key = columnKey(column);
  // Same 3+ character floor as the offline matcher's fuzzyColumn, so a short
  // key like "id" doesn't false-match almost any request.
  return key.length >= 3 && reqKey.includes(key);
}

// findings: the full checkupSheet(sheet) output (not filtered by dismiss/select
// state) — a request should still be able to reach a finding the user dismissed.
export function matchCleanRequest(request, findings) {
  const text = String(request || "").trim();
  if (!text) return { kind: "empty" };

  const intent = INTENTS.find((i) => i.re.test(text));
  if (!intent) return { kind: "unrecognized", text };

  const candidates = findings.filter((f) => intent.types.includes(f.type));
  if (candidates.length === 0) return { kind: "not-found", intent: intent.name };

  const reqKey = columnKey(text);
  const columnHits = candidates.filter((f) => f.column && columnNamedInRequest(f.column, reqKey));
  const pool = columnHits.length > 0 ? columnHits : candidates;

  if (pool.length > 1) return { kind: "ambiguous", intent: intent.name, candidates: pool };

  const finding = pool[0];
  if (!finding.fixable) return { kind: "not-fixable", intent: intent.name, finding };
  return { kind: "matched", intent: intent.name, finding };
}

// Plain-English feedback for every result kind except "ambiguous" (the caller
// renders that one as a pick-a-column list) and "empty" (nothing submitted).
export function cleanRequestMessage(result) {
  switch (result.kind) {
    case "matched":
      return `Ticked: ${result.finding.title}.`;
    case "not-found":
      return NOT_FOUND_MESSAGE[result.intent] || "Nothing matching was found in this sheet.";
    case "not-fixable":
      // Reuse the scan's own detail sentence — it already says exactly why this
      // one can't be auto-fixed, so there's no separate wording to keep honest.
      return result.finding.detail;
    case "unrecognized":
      return (
        "I can tick fixes here for duplicates, missing values, mixed-format dates, and " +
        "spelling variants — I didn't recognize this as one of those. Add an AI key (top " +
        "right) to describe more complex cleaning in Step 3 below, or tick the fixes by hand."
      );
    default:
      return "";
  }
}
