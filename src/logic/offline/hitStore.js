// Phase 6 (plan-2026-07-10-offline-smarts.md) — the in-app "hit" store.
//
// missLog.js already records what the offline engine COULDN'T answer. This is its
// mirror image: the successes. Every time the user accepts an offline answer (or
// confirms a "did you mean…?" chip that then answers), we record the request and
// its value-free plan shape locally. Two payoffs:
//   1. Growth signal — the owner can see which everyday phrasings already work,
//      alongside the misses, to decide what to teach next.
//   2. Bank candidates — `exportBankCandidates()` turns the recorded hits into
//      ready-to-curate seed entries for test/phrase-bank.json, so each release's
//      built-in vocabulary grows from the owner's real files.
//
// PRIVACY: like the alias and graduation stores, a hit holds only the request
// wording and the value-free shape (column names / aggregation / operators) —
// never a cell value (planShape.js is the enforced chokepoint).

import { stripValues } from "./planShape.js";

const KEY = "tidytable_hits";
const MAX = 500;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    // Storage full or unavailable — a lost hit is not worth interrupting the user.
  }
}

// Record an accepted answer. `shape` is a value-free planShape; `via` is an
// optional note like "confirmed 'treatment length' → Duration_days" (never a
// cell value). Stripped once more here as a belt-and-braces guarantee.
export function logHit({ request, shape, via }) {
  if (!request || !String(request).trim()) return;
  const list = read();
  list.push({
    request: String(request).trim(),
    shape: shape ? stripValues(shape) : null,
    via: via || null,
    at: new Date().toISOString(),
  });
  write(list);
}

export function listHits() {
  return read();
}

export function clearHits() {
  write([]);
}

// A plain-text export the owner can read to see which phrasings already work.
export function formatHits(list = read()) {
  if (!list.length) return "No accepted offline answers recorded yet.\n";
  const lines = ["Requests TidyTable answered offline (and the user accepted)", ""];
  for (const h of list) {
    const shape = h.shape ? describeShape(h.shape) : "(shape not recorded)";
    lines.push(`- ${h.at.slice(0, 10)}  ${shape}  ${h.request}`);
  }
  return lines.join("\n") + "\n";
}

// A one-line, value-free description of a shape for the export.
function describeShape(shape) {
  if (shape.intent === "topN" && shape.topN) return `[rank ${shape.topN.column || "?"} by ${shape.topN.family}]`;
  if (shape.target) return `[${shape.intent} of ${shape.target}${shape.group ? ` by ${shape.group}` : ""}]`;
  const cols = (shape.filters || []).map((f) => f.column);
  return `[${shape.intent}${cols.length ? ` on ${[...new Set(cols)].join(", ")}` : ""}]`;
}

// Turn recorded hits into de-duplicated, ready-to-curate phrase-bank candidate
// entries (request wording + shape). The owner curates the best into the seed
// bank each release. Value-free by construction (the shapes already are).
export function exportBankCandidates(list = read()) {
  const seen = new Set();
  const out = [];
  for (const h of list) {
    if (!h.shape) continue;
    const key = `${String(h.request).trim().toLowerCase()}|${JSON.stringify(h.shape)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ phrasing: String(h.request).trim(), shape: h.shape });
  }
  return out;
}
