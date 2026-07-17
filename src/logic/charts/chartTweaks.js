// Phase 8.5 — post-draw tweaks in words. A small, DETERMINISTIC verb set that
// adjusts a chart already on screen: "only top 5", "sort alphabetically", "show
// as percentages", "flip the axes", "hide the blanks". No AI, no free parsing —
// each phrase maps to one normalized tweak the panel applies and appends to the
// chart's recipe so a replay keeps it. An unrecognized phrase returns
// { kind: "unknown" } so the UI says plainly it didn't understand, never
// silently doing nothing.

import { foldKey } from "../checkup/normalizers.js";

// P3-3: "highlight X" / "highlight the X bar" — a category NAMED in the
// tweak text, resolved against the chart's OWN category labels (foldKey,
// case/spacing-insensitive; a substring match counts too, e.g. "highlight
// nitro" for "Nitrofurantoin"). Never guesses: an exact match wins outright,
// a single partial match resolves, more than one candidate comes back
// flagged `ambiguous` instead of picking one, and no match at all returns
// null so the caller can say so honestly.
export function matchHighlightLabel(text, dataset) {
  const m = String(text || "").toLowerCase().match(/\bhighlight\s+(?:the\s+)?(.+?)(?:\s+bar|\s+slice|\s+row)?\s*$/);
  if (!m || !dataset?.points?.length) return null;
  const want = foldKey(m[1].trim());
  if (!want) return null;
  const exact = dataset.points.find((p) => foldKey(p.label) === want);
  if (exact) return { label: exact.label };
  const partial = dataset.points.filter((p) => foldKey(p.label).includes(want));
  if (partial.length === 1) return { label: partial[0].label };
  if (partial.length > 1) return { ambiguous: partial.map((p) => p.label) };
  return null;
}

// P3-3: "average" / "mean" → a dashed line at the mean of the dataset's OWN
// plotted values (never a number pulled from nowhere). "line at 5" /
// "threshold 6" / "reference 4.5" → an explicit value used as-is. Returns
// null for anything else.
export function matchReferenceLine(text, dataset) {
  const t = String(text || "").trim().toLowerCase();
  if (!dataset?.points?.length) return null;
  if (/\b(average|mean)\b/.test(t)) {
    const values = dataset.points.map((p) => p.value);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    return { value: Math.round(avg * 100) / 100, label: "average" };
  }
  const explicit = t.match(/\b(?:threshold|reference|line\s+at)\s*(?:line)?\s*(?:of|at)?\s*(-?\d+(?:\.\d+)?)\b/);
  if (explicit) return { value: Number(explicit[1]), label: explicit[1] };
  return null;
}

// Returns one of:
//   { kind: "topn", n }               — cap to the top n categories
//   { kind: "sort", mode }            — "alpha" | "value" (largest first)
//   { kind: "percent" }               — show shares as a percentage
//   { kind: "blanks" }                — hide blank/empty categories
//   { kind: "flip" }                  — swap the axes (vertical <-> horizontal)
//   { kind: "highlight", label }      — P3-3: accent one named category
//   { kind: "highlight-ambiguous", options } — P3-3: more than one category matched
//   { kind: "highlight-unmatched", text }    — P3-3: no category matched
//   { kind: "reference", value, label } — P3-3: dashed average/threshold line
//   { kind: "unknown", text }         — not understood; the UI asks for a rephrase
// `dataset` (optional) is the chart currently on screen — only "highlight"
// and "reference" need it, since they resolve against the chart's own data
// rather than parsing structure out of the words alone.
export function parseChartTweak(text, dataset = null) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return { kind: "unknown", text: "" };

  // P3-3: "highlight X" — checked first since "highlight" doesn't collide
  // with any existing verb below.
  if (/\bhighlight\b/.test(t)) {
    const m = matchHighlightLabel(t, dataset);
    if (m?.label) return { kind: "highlight", label: m.label };
    if (m?.ambiguous) return { kind: "highlight-ambiguous", options: m.ambiguous };
    return { kind: "highlight-unmatched", text: t };
  }

  // P3-3: "average"/"mean"/"threshold N"/"reference N"/"line at N".
  if (/\b(average|mean|threshold|reference)\b/.test(t) || /\bline\s+at\b/.test(t)) {
    const ref = matchReferenceLine(t, dataset);
    if (ref) return { kind: "reference", ...ref };
  }

  // "only top 5" / "top 5" / "just the top 3" / "show 5" — a cap.
  const top = t.match(/\b(?:only\s+)?(?:the\s+)?(?:top|first|show)\s+(\d{1,3})\b/) || t.match(/\btop\s+(\d{1,3})\b/);
  if (top) return { kind: "topn", n: Number(top[1]) };

  // "sort alphabetically" / "a to z" / "by name".
  if (/\balphabetical(?:ly)?\b|\ba\s*(?:to|-|–)?\s*z\b|\bby name\b|\bby label\b/.test(t)) {
    return { kind: "sort", mode: "alpha" };
  }
  // "sort by size" / "largest first" / "biggest first" / "by value" — the default.
  if (/\b(largest|biggest|by size|by value|by count|most first|descending)\b/.test(t)) {
    return { kind: "sort", mode: "value" };
  }

  // "show as percentages" / "as a percent" / "as %".
  if (/\b(percent|percentage|percentages|%|share)\b/.test(t)) return { kind: "percent" };

  // "hide the blanks" / "drop empties" / "remove missing".
  if (/\b(blank|blanks|empty|empties|missing|n\/?a)\b/.test(t)) return { kind: "blanks" };

  // "flip the axes" / "rotate" / "make it horizontal|vertical".
  if (/\b(flip|rotate|swap the axes|horizontal|vertical|sideways|on its side)\b/.test(t)) {
    return { kind: "flip" };
  }

  return { kind: "unknown", text: t };
}

// Sort a categorical dataset's points without touching the numbers. "alpha" is
// a case-insensitive A→Z by label; "value" restores largest-first. Time-series
// and xy datasets are left alone (a chronological x-axis must not be reordered).
export function sortDataset(dataset, mode) {
  if (!dataset || dataset.kind !== "categorical" || dataset.labelIsTime) return dataset;
  const points = [...dataset.points];
  if (mode === "alpha") {
    points.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" }));
  } else {
    points.sort((a, b) => b.value - a.value);
  }
  return { ...dataset, points };
}
