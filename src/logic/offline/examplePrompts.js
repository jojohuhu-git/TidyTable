// W2f: build a handful of example questions straight from the user's own
// uploaded sheet — one per supported offline pattern — so the examples always
// use real column and value names and always return a non-trivial answer.
//
// Each candidate example is verified through the SAME matchRequest() the real
// run uses before it is shown, so a chip is never a promise the engine can't
// keep. A "works offline" example is one matchRequest resolves to a confident
// answer OR to a one-click "Did you mean…?" confirmation (needs_confirm) — both
// are answered on this computer with no key. Filler examples that would decline
// are dropped rather than shown.

import { matchRequest } from "./matcher.js";

const MAX_ROWS_SCANNED = 300;
const MAX_VALUE_LEN = 40;

const OFFLINE_STATUSES = new Set(["confident", "needs_confirm"]);

function resolvesOffline(text, workbook) {
  const m = matchRequest(text, workbook, { present: false });
  return OFFLINE_STATUSES.has(m.status);
}

// Profile each column once: its most-frequent short text value (for count/
// proportion/nested filters), whether it looks numeric (for a threshold), and
// how many distinct values it has (a low-cardinality text column is a good
// group-by / "by X" label).
function profileColumns(sheet) {
  const rows = sheet.rows.slice(0, MAX_ROWS_SCANNED);
  return sheet.headers.map((h) => {
    const counts = new Map(); // folded -> { raw, count }
    let numericCount = 0;
    let nonNull = 0;
    for (const r of rows) {
      const v = r[h.name];
      if (v == null || String(v).trim() === "") continue;
      nonNull++;
      const raw = String(v).trim();
      if (typeof v === "number" || /^-?\d+(?:\.\d+)?$/.test(raw)) numericCount++;
      if (raw.length <= MAX_VALUE_LEN) {
        const key = raw.toLowerCase();
        const e = counts.get(key) || { raw, count: 0 };
        e.count += 1;
        counts.set(key, e);
      }
    }
    const values = [...counts.values()].sort((a, b) => b.count - a.count);
    const isNumeric = nonNull > 0 && numericCount / nonNull >= 0.8;
    // An ID-like column is a mostly-distinct TEXT column — a poor group label
    // and a poor filter value ("how many have P4?" is a triviality). A numeric
    // column is often all-distinct too (durations, ages) but is not an ID, so
    // it's never flagged ID-like — it's the source of threshold/average examples.
    const idLike = !isNumeric && nonNull >= 4 && counts.size / nonNull >= 0.8;
    return {
      name: h.name,
      topValue: values[0]?.raw || null,
      topCount: values[0]?.count || 0,
      distinct: counts.size,
      idLike,
      isNumeric,
      numericSample: values.find((v) => /^-?\d+(?:\.\d+)?$/.test(v.raw))?.raw || null,
    };
  });
}

// Public: up to `max` verified, plain-English example questions for this sheet,
// each tagged with the pattern it demonstrates. Returns [] when there's no data
// or nothing verifiable (e.g. an empty upload).
export function buildExamplePrompts(workbook, max = 6) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet || !sheet.rows?.length || !sheet.headers?.length) return [];
  const cols = profileColumns(sheet);

  // A repeating text value (not an ID) is the backbone of most examples.
  const withValue = cols.filter((c) => c.topValue && c.topCount >= 2 && !c.idLike);
  const primary = [...withValue].sort((a, b) => b.topCount - a.topCount)[0]
    || cols.filter((c) => c.topValue && !c.idLike).sort((a, b) => b.topCount - a.topCount)[0]
    || null;
  // A different low-cardinality, non-ID text column makes a good "by X" label —
  // prefer the fewest distinct values (the clearest breakdown).
  const groupCandidates = cols
    .filter((c) => !c.isNumeric && !c.idLike && c.distinct >= 2 && c.distinct <= 12)
    .sort((a, b) => a.distinct - b.distinct);
  const groupCol = groupCandidates.find((c) => !primary || c.name !== primary.name)
    || groupCandidates[0] || null;
  const numericCol = cols.find((c) => c.isNumeric && !c.idLike && c.numericSample != null);

  const out = [];
  const push = (text, pattern) => {
    if (!text) return;
    if (out.some((e) => e.text === text)) return;
    if (!resolvesOffline(text, workbook)) return;
    out.push({ text, pattern });
  };

  // count + value (+ column scope)
  if (primary) {
    push(`How many rows have ${primary.topValue} in ${primary.name}?`, "count");
    push(`How many rows have ${primary.topValue}?`, "count");
  }
  // proportion
  if (primary) {
    push(`What percent of rows have ${primary.topValue}?`, "proportion");
  }
  // average / sum by group
  if (numericCol && groupCol) {
    push(`Average ${numericCol.name} by ${groupCol.name}`, "average + group");
  } else if (numericCol) {
    push(`Average ${numericCol.name}`, "average");
  }
  // threshold
  if (numericCol && numericCol.numericSample != null) {
    const n = Math.round(Number(numericCol.numericSample));
    push(`How many rows have ${numericCol.name} over ${n}?`, "threshold");
    push(`How many rows have ${numericCol.name} over ${Math.max(0, n - 1)}?`, "threshold");
  }
  // count by group (a plain breakdown)
  if (groupCol) {
    push(`How many rows by ${groupCol.name}?`, "count + group");
  }
  // nested: of X, how many also Y
  if (primary) {
    const other = withValue.find((c) => c.name !== primary.name && c.topValue);
    if (other) {
      push(`Of rows with ${primary.topValue}, how many have ${other.topValue}?`, "nested");
    }
  }

  return out.slice(0, max);
}

// The plain-words cheat-sheet of the five intents the offline engine supports,
// shown in a collapsible "What kinds of questions work without AI" panel (W2f).
// Static — it describes capabilities, not this file, so it never needs the data.
export const OFFLINE_INTENTS = [
  { intent: "Count", plain: "how many rows match something", example: "How many rows have UTI?" },
  { intent: "Share / percent", plain: "what fraction of rows match", example: "What percent of rows have UTI?" },
  { intent: "Average or total", plain: "the mean or sum of a number column, optionally per group", example: "Average Duration_days by Ward" },
  { intent: "Threshold", plain: "rows where a number is over / under / at least a value", example: "How many rows have Age over 65?" },
  { intent: "Nested (of those…)", plain: "narrow one group, then count inside it", example: "Of rows with UTI, how many stayed over 7 days?" },
];
