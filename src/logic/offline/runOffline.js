// Top of the offline engine (build prompt §3.3, §8). Every request tries this
// before the Claude API. It returns a small tagged result the UI acts on, so a
// confident answer never needs a key, an undefined clinical term blocks plainly,
// a per-patient question over repeating rows asks first, and anything truly out
// of range declines gracefully and is logged — never a confident wrong answer.

import { parseDefinitions } from "./definitions.js";
import { matchRequest, conditionPhrase } from "./matcher.js";
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

  if (match.status === "partial") {
    return { kind: "block", message: buildPartialMessage(match) };
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
    message: buildDeclineMessage(match),
  };
}

// A3 Level 1: "average"/"sum"/"per X"/"by X" are a real capability gap (the
// offline engine only ever counts or shares rows — see fillPlan.js), not an
// undefined clinical term, so say that plainly instead of the generic decline.
const UNSUPPORTED_LEAD = {
  "unsupported-average": "This asks for an average, which the offline engine cannot compute yet — it can only count or share rows.",
  "unsupported-sum": "This asks for a total/sum, which the offline engine cannot compute yet — it can only count or share rows.",
  "unsupported-groupby": "This asks for a breakdown per group (\"per\"/\"by\"/\"grouped by\"), which the offline engine cannot compute yet — it can only count or share rows for one cohort at a time.",
};

function buildDeclineMessage(match) {
  const lead = UNSUPPORTED_LEAD[match.reason]
    || "This request needs the AI mode — the offline engine could not answer it with confidence, so it will not guess.";
  return `${lead} Add your key at the top right to send it to Claude, or rephrase it as a count or share of rows.`;
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

// A2: the question packed more than one condition into one clause and only
// part of it could be understood. Say exactly what was understood and ask
// for a rephrase, rather than silently answering with just that part.
function buildPartialMessage(match) {
  const understoodPhrase = match.understood ? conditionPhrase(match.understood) : `"${match.clause}"`;
  return (
    `I understood ${understoodPhrase} but could not understand "${match.unmatchedText}" in "${match.clause}". ` +
    `I will not guess and drop part of your question. Try asking just the part I understood, or split it, e.g. ` +
    `"of patients with ${match.understood?.value ?? "..."}, how many had ${match.unmatchedText}?"`
  );
}

// A one-line hint for the Claude fallback (build prompt §8, §5): only the shape
// of what the engine understood, never real cell values.
function buildClaudeHint(match) {
  if (match.reason === "no-conditions") {
    return "A local pre-check understood a count-type request but could not tell which columns or values to filter on.";
  }
  if (match.reason === "unsupported-average" || match.reason === "unsupported-sum" || match.reason === "unsupported-groupby") {
    return "A local pre-check recognized this asks for an average/sum/group-by breakdown, which the offline engine does not compute.";
  }
  return "A local pre-check did not recognize this as a count or share of rows.";
}
