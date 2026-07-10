// Top of the offline engine (build prompt §3.3, §8). Every request tries this
// before the Claude API. It returns a small tagged result the UI acts on, so a
// confident answer never needs a key, an undefined clinical term blocks plainly,
// a per-patient question over repeating rows asks first, and anything truly out
// of range declines gracefully and is logged — never a confident wrong answer.

import { parseDefinitions } from "./definitions.js";
import { mergeDefinitions } from "./definitionsStore.js";
import { matchRequest, conditionPhrase } from "./matcher.js";
import { fillPlan } from "./fillPlan.js";
import { logMiss } from "./missLog.js";

// options.grainMode: pass "group-then-test" after the user agrees to combine rows.
// options.definitionsStore: B7's in-app definitions (see definitionsStore.js),
// merged on top of a real Definitions sheet if the workbook has one.
export function runOffline(request, workbook, options = {}) {
  if (!workbook?.sheets?.length) {
    return { kind: "decline", reason: "no-data", message: "Upload a spreadsheet first." };
  }
  const sheetDefs = parseDefinitions(workbook);
  const defs = options.definitionsStore ? mergeDefinitions(sheetDefs, options.definitionsStore) : sheetDefs;
  const match = matchRequest(request, workbook, defs, options);

  if (match.status === "confident") {
    const { plan, resultRows, exec } = fillPlan(match, workbook);
    // W3: `match` is handed back too, so a successful offline answer can be
    // recorded as a replayable "question" step (see recipe.js questionStep) —
    // it carries the resolved columns/values, not just the plan text.
    return { kind: "answer", plan, resultRows, lookedFor: match.lookedFor, exec, match };
  }

  if (match.status === "needs_definitions") {
    return {
      kind: "block",
      missingTerms: match.missingTerms,
      definitionsPresent: match.definitionsPresent,
      message: buildBlockMessage(match),
      // W2e: the nearest values/columns the app CAN see for the first missing
      // term, so the UI can offer them as clickable chips instead of jumping
      // straight to "add a definition" / "use AI".
      nearest: match.missingTerms?.[0]?.nearest || [],
    };
  }

  if (match.status === "partial") {
    return { kind: "block", message: buildPartialMessage(match) };
  }

  if (match.status === "grain") {
    return { kind: "clarify-grain", grain: match.grain, request };
  }

  // W2d: the app had to stretch (an abbreviation, a partial/prefix value
  // match, a fuzzy column scope, or a tie) to reach a value. Ask "Did you
  // mean…?" instead of silently answering or refusing — the middle path.
  if (match.status === "needs_confirm") {
    return {
      kind: "confirm-value",
      phrase: match.phrase,
      candidates: match.candidates,
      via: match.via,
      request,
    };
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

// The engine CAN average/sum/group-by since A3 Level 2 — these reasons now
// mean it couldn't pin down WHICH column, so say that honestly instead of the
// old (now false) "cannot compute yet".
const UNSUPPORTED_LEAD = {
  "unsupported-average": "This asks for an average, but I couldn't tell which column of numbers to average. Name the column directly (e.g. \"average Duration_days\").",
  "unsupported-sum": "This asks for a total/sum, but I couldn't tell which column of numbers to add up. Name the column directly (e.g. \"total Duration_days\").",
  "unsupported-groupby": "This asks for a per-group breakdown, but I couldn't tell which column to group by. Name it directly (e.g. \"per Diagnosis\").",
  "unsupported-median": "This asks for a median, but I couldn't tell which column of numbers. Name the column directly (e.g. \"median Duration_days\").",
  "unsupported-quartiles": "This asks for quartiles, but I couldn't tell which column of numbers. Name the column directly (e.g. \"quartiles of Duration_days\").",
  "unsupported-stdev": "This asks for a standard deviation, but I couldn't tell which column of numbers. Name the column directly (e.g. \"standard deviation of Duration_days\").",
  "unsupported-min": "This asks for a minimum, but I couldn't tell which column of numbers. Name the column directly (e.g. \"minimum Duration_days\").",
  "unsupported-max": "This asks for a maximum, but I couldn't tell which column of numbers. Name the column directly (e.g. \"maximum Duration_days\").",
  "unsupported-range": "This asks for a range, but I couldn't tell which column of numbers. Name the column directly (e.g. \"range of Duration_days\").",
  "unsupported-describe": "This asks to describe/summarize a column, but I couldn't tell which one. Name the column directly (e.g. \"describe Duration_days\").",
};

// Phase 2: the verb used in the non-numeric-target decline for each stat
// intent — "add up" for sum, "find the median of" for median, etc.
const NON_NUMERIC_VERB = {
  sum: "add up", median: "find the median of", quartiles: "find the quartiles of",
  stdev: "find the standard deviation of", min: "find the minimum of",
  max: "find the maximum of", range: "find the range of", describe: "describe",
};

function buildDeclineMessage(match) {
  // Honesty bug 1 (2026-07-10): averaging a text column refuses plainly.
  if (match.reason === "non-numeric-target") {
    const verb = NON_NUMERIC_VERB[match.aggIntent] || "average";
    return (
      `"${match.targetColumn}" contains words, not numbers — I can't ${verb} it. ` +
      `Name a numeric column instead (e.g. "average Duration_days"), or rephrase as a count ` +
      `(e.g. "how many rows have ... in ${match.targetColumn}").`
    );
  }
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
    return "A local pre-check recognized this asks for an average/sum/group-by breakdown but could not resolve which column it applies to.";
  }
  if (match.reason === "non-numeric-target") {
    return "A local pre-check found this asks to average or sum a text (non-numeric) column, which it refused.";
  }
  return "A local pre-check did not recognize this as a count or share of rows.";
}
