// B6: a per-column overview for Step 1/2 — "which column is my outcome, which
// is broken" at a glance. Renders from data the app already has (headers with
// letter/type, rows); the profile itself samples the same first-500-rows
// window `parseWorkbookFile` already uses for type inference and examples, so
// this adds no new full-sheet scan on a large file.

import { coerceNumbers } from "./checkup/normalizers.js";

const PROFILE_SAMPLE_SIZE = 500;

function foldForDistinct(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : v;
}

// NEW-5: a column stored entirely as text-formatted numbers (with one stray
// real float mixed in, or none) parses as "text" or "mixed (text + numbers)"
// at the raw-type level — accurate, but unhelpful for the profile table,
// which would otherwise show a top-3-by-frequency list of what's really a
// numeric range. Detect it and profile it as numeric instead.
function looksNumericAsText(type, nonNull) {
  if (type !== "text" && type !== "mixed (text + numbers)") return false;
  if (nonNull.length === 0) return false;
  return nonNull.every((v) => typeof v === "number" || (typeof v === "string" && typeof coerceNumbers(v) === "number"));
}

export function buildColumnProfile(sheet) {
  const sample = sheet.rows.slice(0, PROFILE_SAMPLE_SIZE);
  return sheet.headers.map((h) => {
    const values = sample.map((r) => r[h.name]);
    const nonNull = values.filter((v) => v != null && String(v).trim() !== "");
    const filledPct = sample.length ? Math.round((nonNull.length / sample.length) * 100) : 0;
    const distinctCount = new Set(nonNull.map(foldForDistinct)).size;
    const numericAsText = looksNumericAsText(h.type, nonNull);
    const type = numericAsText ? "number (stored as text)" : h.type;

    let summary;
    if (nonNull.length === 0) {
      summary = "empty column";
    } else if (h.type === "number" || numericAsText) {
      const nums = nonNull.map((v) => (typeof v === "number" ? v : coerceNumbers(v)));
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      summary = min === max ? `constant: ${min}` : `${min} – ${max}`;
    } else {
      const counts = new Map();
      for (const v of nonNull) {
        const key = String(v);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      summary = top.map(([v, c]) => `${v} (${c})`).join(", ");
    }

    return {
      letter: h.letter,
      name: h.name,
      type,
      filledPct,
      distinctCount,
      summary,
      isEmpty: nonNull.length === 0,
      isConstant: distinctCount === 1 && nonNull.length > 0,
      sampledRows: sample.length,
      totalRows: sheet.rows.length,
    };
  });
}
