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
    lines.push(`- ${m.at.slice(0, 10)}  (${m.reason})  ${m.request}`);
  }
  return lines.join("\n") + "\n";
}
