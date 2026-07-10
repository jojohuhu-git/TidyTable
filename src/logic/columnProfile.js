// B6: a per-column overview for Step 1/2 — "which column is my outcome, which
// is broken" at a glance. Renders from data the app already has (headers with
// letter/type, rows); the profile itself samples the same first-500-rows
// window `parseWorkbookFile` already uses for type inference and examples, so
// this adds no new full-sheet scan on a large file.

const PROFILE_SAMPLE_SIZE = 500;

function foldForDistinct(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : v;
}

export function buildColumnProfile(sheet) {
  const sample = sheet.rows.slice(0, PROFILE_SAMPLE_SIZE);
  return sheet.headers.map((h) => {
    const values = sample.map((r) => r[h.name]);
    const nonNull = values.filter((v) => v != null && String(v).trim() !== "");
    const filledPct = sample.length ? Math.round((nonNull.length / sample.length) * 100) : 0;
    const distinctCount = new Set(nonNull.map(foldForDistinct)).size;

    let summary;
    if (nonNull.length === 0) {
      summary = "empty column";
    } else if (h.type === "number") {
      const nums = nonNull.filter((v) => typeof v === "number");
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
      type: h.type,
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
