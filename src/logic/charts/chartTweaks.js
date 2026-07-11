// Phase 8.5 — post-draw tweaks in words. A small, DETERMINISTIC verb set that
// adjusts a chart already on screen: "only top 5", "sort alphabetically", "show
// as percentages", "flip the axes", "hide the blanks". No AI, no free parsing —
// each phrase maps to one normalized tweak the panel applies and appends to the
// chart's recipe so a replay keeps it. An unrecognized phrase returns
// { kind: "unknown" } so the UI says plainly it didn't understand, never
// silently doing nothing.

// Returns one of:
//   { kind: "topn", n }            — cap to the top n categories
//   { kind: "sort", mode }         — "alpha" | "value" (largest first)
//   { kind: "percent" }            — show shares as a percentage
//   { kind: "blanks" }             — hide blank/empty categories
//   { kind: "flip" }               — swap the axes (vertical <-> horizontal)
//   { kind: "unknown", text }      — not understood; the UI asks for a rephrase
export function parseChartTweak(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return { kind: "unknown", text: "" };

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
