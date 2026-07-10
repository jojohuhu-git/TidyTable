// B5: a refresh (or an accidental tab close) used to wipe the session log and
// any in-progress recipe with no warning. The uploaded workbook itself is not
// persisted here — re-parsing a large file from localStorage on every change
// would be slow and the file may hold sensitive data the user doesn't want
// sitting in browser storage indefinitely. The log and recipe are small JSON
// and are the user's defensibility trail, so those are worth surviving a
// refresh; losing the loaded file just means re-uploading to keep working.

const STORAGE_KEY = "tidytable_session_v1";

// W3: `results` is the "Your results so far" list (see App.jsx) — callers
// pass a version with plan/resultRows already stripped, since those can be as
// large as the workbook itself; only the small display fields survive here.
export function saveSession({ sessionLog, recipe, results }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionLog, recipe, results }));
  } catch {
    // Storage can be full or disabled (private browsing); losing the
    // refresh-survival nicety is not worth surfacing an error for.
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      sessionLog: Array.isArray(parsed.sessionLog) ? parsed.sessionLog : [],
      recipe: parsed.recipe || null,
      results: Array.isArray(parsed.results) ? parsed.results : [],
    };
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
