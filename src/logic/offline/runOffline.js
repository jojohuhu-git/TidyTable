// Top of the offline engine (build prompt §3.3, §8). Every request tries this
// before the Claude API. It returns a small tagged result the UI acts on, so a
// confident answer never needs a key, an undefined clinical term blocks plainly,
// a per-patient question over repeating rows asks first, and anything truly out
// of range declines gracefully and is logged — never a confident wrong answer.

import { parseDefinitions } from "./definitions.js";
import { matchRequest } from "./matcher.js";
import { fillPlan } from "./fillPlan.js";
import { logMiss } from "./missLog.js";

// options.grainMode: pass "group-then-test" after the user agrees to combine rows.
export function runOffline(request, workbook, options = {}) {
  if (!workbook?.sheets?.length) {
    return { kind: "decline", reason: "no-data", message: "Upload a spreadsheet first." };
  }
  const defs = parseDefinitions(workbook);
  const match = matchRequest(request, workbook, defs, options);

  if (match.status === "confident") {
    const { plan, resultRows, exec } = fillPlan(match, workbook);
    return { kind: "answer", plan, resultRows, lookedFor: match.lookedFor, exec };
  }

  if (match.status === "needs_definitions") {
    return {
      kind: "block",
      missingTerms: match.missingTerms,
      definitionsPresent: match.definitionsPresent,
      message: buildBlockMessage(match),
    };
  }

  if (match.status === "grain") {
    return { kind: "clarify-grain", grain: match.grain, request };
  }

  // Not our kind of request. Log it for the growth loop and offer Claude.
  logMiss({ request, reason: match.reason || "none" });
  return {
    kind: "decline",
    reason: match.reason || "none",
    claudeHint: buildClaudeHint(match),
    message:
      "This request needs the AI mode — the offline engine could not answer it with confidence, so it will not guess. " +
      "Add your key at the top right to send it to Claude, or rephrase it as a count or share of rows.",
  };
}

// Plain block message when a clinical term is undefined (refuse, don't guess).
function buildBlockMessage(match) {
  const terms = match.missingTerms.map((m) => `"${m.term}"`);
  const list = terms.length === 1 ? terms[0] : terms.slice(0, -1).join(", ") + " and " + terms.slice(-1);
  const lead = match.definitionsPresent
    ? `Your Definitions sheet does not say what counts as ${list}.`
    : `This question uses ${list}, which the data does not define, and there is no Definitions sheet yet.`;
  return (
    `${lead} I will not guess clinical meaning. Add a row to a sheet named "Definitions" with three columns — ` +
    `the term, the column it applies to, and the values (or a rule like "> 7 when Diagnosis = pyelonephritis") that count — then ask again.`
  );
}

// A one-line hint for the Claude fallback (build prompt §8, §5): only the shape
// of what the engine understood, never real cell values.
function buildClaudeHint(match) {
  if (match.reason === "no-conditions") {
    return "A local pre-check understood a count-type request but could not tell which columns or values to filter on.";
  }
  return "A local pre-check did not recognize this as a count or share of rows.";
}
