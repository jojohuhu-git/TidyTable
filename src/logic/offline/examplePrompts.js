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
import { resolveChartRequest } from "../charts/textToChart.js";
import { analyze } from "../stats/runStats.js";
import { reshapeWideToLong } from "./shelf.js";
import { columnPickerOptions } from "../columnPickerOptions.js";

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

// P2-4: up to `max` verified chart requests for Step 9's "Try these", built
// from the sheet's own column names in the same "by X" / bare-column phrasing
// the free-text box already understands (resolveChartRequest is the SAME
// pipeline "Make this chart" runs, so a shown example is never a promise the
// chart box can't keep).
export function buildChartExamplePrompts(sheet, max = 3) {
  if (!sheet?.rows?.length || !sheet.headers?.length) return [];
  const cols = profileColumns(sheet);
  const groupCandidates = cols
    .filter((c) => !c.isNumeric && !c.idLike && c.distinct >= 2 && c.distinct <= 12)
    .sort((a, b) => a.distinct - b.distinct);
  const numericCol = cols.find((c) => c.isNumeric && !c.idLike);

  const out = [];
  const push = (text) => {
    if (!text || out.includes(text)) return;
    const res = resolveChartRequest(text, sheet);
    if (res.status !== "resolved") return;
    out.push(text);
  };

  for (const g of groupCandidates.slice(0, 2)) push(g.name);
  if (numericCol && groupCandidates[0]) push(`average ${numericCol.name} by ${groupCandidates[0].name}`);

  return out.slice(0, max);
}

// Parked item 1(c): example chips for the two-column ("crosstab") chart shape
// and its cohort-filtered variant — built from the user's OWN low-cardinality
// category columns. A cohort chip's VALUE only ever comes from a low-
// cardinality category column (never an ID-like or free-text one, via
// `profileColumns`' `idLike`/`distinct` checks already used above) — that
// keeps MRNs, names, and free-text notes out of the UI, not just out of the
// resolved chart. Design rule (owner-agreed): each chip carries the fully
// RESOLVED plan object from build time (verified once, right here, through
// the real resolveChartRequest), not its text — clicking it can never
// re-parse into something different from what was shown.
export function buildCrosstabExamplePrompts(sheet, max = 2) {
  if (!sheet?.rows?.length || !sheet.headers?.length) return [];
  const cols = profileColumns(sheet);
  const categoryCols = cols
    .filter((c) => !c.isNumeric && !c.idLike && c.distinct >= 2 && c.distinct <= 12)
    .sort((a, b) => a.distinct - b.distinct);
  if (categoryCols.length < 2) return [];
  const [a, b] = categoryCols;

  const out = [];
  const baseText = `${b.name} by ${a.name}`;
  const baseRes = resolveChartRequest(baseText, sheet);
  if (baseRes.status === "resolved" && baseRes.kind === "crosstab") {
    out.push({ caption: baseText, plan: baseRes });
  }

  const cohortCol = categoryCols.find((c) => c.name !== a.name && c.name !== b.name && c.topValue);
  if (cohortCol) {
    const cohortText = `of ${cohortCol.topValue} rows, ${b.name} by ${a.name}`;
    const cohortRes = resolveChartRequest(cohortText, sheet);
    if (cohortRes.status === "resolved" && cohortRes.kind === "crosstab" && cohortRes.filter) {
      out.push({ caption: `${b.name} by ${a.name}, only ${cohortCol.name}: ${cohortCol.topValue}`, plan: cohortRes });
    }
  }

  return out.slice(0, max);
}

// P2-4: up to `max` verified grouping/outcome column pairs for Step 7's
// "Try these", each actually run through analyze() so a shown example always
// produces a real comparison rather than the "needs exactly two groups"
// decline.
export function buildStatsExamples(sheet, max = 2) {
  if (!sheet?.rows?.length || !sheet.headers?.length) return [];
  const grouping = columnPickerOptions(sheet, "grouping").filter((o) => o.likely);
  const outcome = columnPickerOptions(sheet, "outcome").filter((o) => o.likely);

  const out = [];
  for (const g of grouping) {
    for (const o of outcome) {
      if (g.name === o.name) continue;
      if (out.some((e) => e.colA === g.name && e.colB === o.name)) continue;
      let result;
      try {
        result = analyze(sheet, g.name, o.name);
      } catch {
        continue;
      }
      if (!result?.ok) continue;
      out.push({ colA: g.name, colB: o.name, label: `${o.name} by ${g.name}` });
      if (out.length >= max) return out;
    }
  }
  // Two categorical columns (a contingency table) is also a valid comparison —
  // try a pair of grouping-typed columns if the numeric pairing above found
  // nothing.
  if (out.length < max) {
    for (let i = 0; i < grouping.length && out.length < max; i++) {
      for (let j = i + 1; j < grouping.length && out.length < max; j++) {
        const a = grouping[i], b = grouping[j];
        if (out.some((e) => e.colA === a.name && e.colB === b.name)) continue;
        let result;
        try {
          result = analyze(sheet, a.name, b.name);
        } catch {
          continue;
        }
        if (!result?.ok) continue;
        out.push({ colA: a.name, colB: b.name, label: `${a.name} vs ${b.name}` });
      }
    }
  }
  return out;
}

// P2-4: up to `max` verified reshape examples for Step 10's "Try these",
// limited to the ONE operation that needs only the first sheet — wide→long —
// since the other five shelf operations need a second sheet uploaded before
// a chip could honestly run them. Each candidate is actually reshaped and
// only kept if it produces real rows.
export function buildShelfExamples(sheet, max = 1) {
  if (!sheet?.rows?.length || !sheet.headers?.length) return [];
  const cols = profileColumns(sheet);
  const idCol = cols.find((c) => c.idLike);
  if (!idCol) return [];
  const bring = cols.filter((c) => c.name !== idCol.name && c.topValue).slice(0, 2).map((c) => c.name);
  if (!bring.length) return [];
  let rows;
  try {
    rows = reshapeWideToLong(sheet.rows, idCol.name, bring);
  } catch {
    return [];
  }
  if (!rows.length) return [];
  return [{ key: idCol.name, bring, label: `Turn ${bring.join(" & ")} into one row each per ${idCol.name}` }].slice(0, max);
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
