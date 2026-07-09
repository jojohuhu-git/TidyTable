// A4: PromptPanel's fixed example chips are all worded as things the offline
// engine cannot compute — a filter that needs "over 65" reasoning plus a
// missing-value check, a sum-per-group, a duplicate-ID scan, a text-cleanup
// transform. None of them can resolve through runOffline(), so every example
// "fails without an API key," which is exactly backwards for a chip whose
// point is to show what the app can already do for free.
//
// Build one additional example straight from the user's own uploaded data,
// and verify it with the same matchRequest() the real run uses before ever
// showing it — so the chip is provably answerable offline, not just guessed
// to look that way.

import { matchRequest } from "./matcher.js";

const MAX_ROWS_SCANNED = 200;
const MAX_VALUE_LEN = 40;

// Public: a plain-English "how many rows have X" question built from a real
// column/value pair in the sheet, or null if no sheet or no safe candidate
// value exists yet (e.g. an empty upload). Prefers a value that repeats, so
// the demo count is more than 1 and reads as a real answer, not a triviality.
export function buildOfflineExample(workbook) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet || !sheet.rows?.length || !sheet.headers?.length) return null;

  const rows = sheet.rows.slice(0, MAX_ROWS_SCANNED);
  const candidates = [];
  for (const h of sheet.headers) {
    const counts = new Map(); // folded value -> { raw, count }
    for (const r of rows) {
      const v = r[h.name];
      if (v == null) continue;
      const raw = String(v).trim();
      if (!raw || raw.length > MAX_VALUE_LEN) continue;
      const key = raw.toLowerCase();
      const entry = counts.get(key) || { raw, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    for (const { raw, count } of counts.values()) candidates.push({ raw, count });
  }
  if (!candidates.length) return null;

  // Repeats first (a more interesting demo), otherwise input order.
  candidates.sort((a, b) => b.count - a.count);

  for (const { raw } of candidates) {
    const text = `How many rows have ${raw}?`;
    const match = matchRequest(text, workbook, { present: false });
    if (match.status === "confident") return text;
  }
  return null;
}
