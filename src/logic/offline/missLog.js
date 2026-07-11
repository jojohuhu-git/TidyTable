// Miss logging (build prompt §8, §13 growth loop). When the offline engine can't
// confidently answer, the request is recorded locally so the owner can review
// what people actually ask and add entries or synonyms over time. Local only,
// exportable, never sent anywhere.

const KEY = "tidytable_misses";
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
    // Storage full or unavailable — a lost miss is not worth interrupting the user.
  }
}

// Record a request the engine could not answer. `reason` is one of the matcher's
// statuses (e.g. "none", "needs_definitions"); `detail` is optional context.
export function logMiss({ request, reason, detail }) {
  if (!request || !String(request).trim()) return;
  const list = read();
  list.push({ request: String(request).trim(), reason: reason || "none", detail: detail || null, at: new Date().toISOString() });
  write(list);
}

// Phase 5: record a refinement exchange that took more than one round (a plain
// round-1 confirm is today's behavior, not news) or that exhausted every guess.
// `outcome` is "refined-success" (user confirmed a candidate after ≥1 "None of
// these") or "refined-exhausted". PRIVACY: `rejectedColumns` are column NAMES
// only — a rejected value candidate contributes its column name, never the cell
// value — so nothing sensitive is ever written to storage.
export function logRefinement({ request, phrase, rounds, outcome, rejectedColumns }) {
  if (!request || !String(request).trim()) return;
  const cols = Array.isArray(rejectedColumns) ? [...new Set(rejectedColumns.filter(Boolean))] : [];
  const list = read();
  list.push({
    request: String(request).trim(),
    reason: outcome || "refined",
    detail: { phrase: phrase || null, rounds: rounds || null, rejectedColumns: cols },
    at: new Date().toISOString(),
  });
  write(list);
}

export function listMisses() {
  return read();
}

export function clearMisses() {
  write([]);
}

// A plain-text export the owner can read to decide what to teach the engine next.
export function formatMisses(list = read()) {
  if (!list.length) return "No unanswered requests recorded yet.\n";
  const lines = ["Requests TidyTable could not answer offline", ""];
  for (const m of list) {
    // Phase 5: a refinement entry carries a round count worth showing, so the
    // owner sees which questions needed more than one "did you mean…?" round.
    const rounds = m.detail && typeof m.detail === "object" ? m.detail.rounds : null;
    const tag = rounds ? `${m.reason}, ${rounds} rounds` : m.reason;
    lines.push(`- ${m.at.slice(0, 10)}  (${tag})  ${m.request}`);
  }
  return lines.join("\n") + "\n";
}
