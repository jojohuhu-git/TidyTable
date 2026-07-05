// Deidentification key file (build prompt §7). A local-only mapping from a real
// name to a stable code (e.g. "Dr. Smith" -> "Prescriber 07"). It is stored
// SEPARATELY from recipes and reports, and can be exported/imported like a
// recipe, because the codes must stay stable month to month so trends are
// trackable.
//
// This file is sensitive: it is the only thing that links a code back to a real
// person. The report generator (reportCards.js) is never given the key — it works
// only on the already-coded table — so a report physically cannot contain a name.

export const KEY_VERSION = 1;

export function newKeyStore(prefix) {
  return {
    version: KEY_VERSION,
    prefix: prefix && String(prefix).trim() ? String(prefix).trim() : "Prescriber",
    next: 1,
    codes: {}, // realName -> code string
  };
}

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

// Assign stable codes to a list of names against a key store, WITHOUT mutating
// the input. Returns:
//   store       — a new store with any new names added
//   assignments — plain object realName -> code (for the names asked about)
//   newlyAdded  — [{ name, code }] for names that did not already have a code
export function assignCodes(store, names) {
  const codes = { ...store.codes };
  let next = store.next;
  const assignments = {};
  const newlyAdded = [];
  for (const raw of names) {
    if (raw == null || String(raw).trim() === "") continue;
    const name = String(raw).trim();
    if (assignments[name]) continue; // already handled this call
    if (codes[name]) {
      assignments[name] = codes[name];
      continue;
    }
    const code = `${store.prefix} ${pad(next)}`;
    codes[name] = code;
    assignments[name] = code;
    newlyAdded.push({ name, code });
    next += 1;
  }
  return {
    store: { ...store, codes, next },
    assignments,
    newlyAdded,
  };
}

// Replace the names in one column of a table with their codes, assigning new
// codes as needed. Returns { rows, store, newlyAdded } — rows are new objects,
// the input is untouched.
export function applyCodesToColumn(store, rows, column) {
  const names = rows.map((r) => r[column]);
  const { store: nextStore, assignments, newlyAdded } = assignCodes(store, names);
  const coded = rows.map((r) => {
    const name = r[column];
    if (name == null || String(name).trim() === "") return { ...r };
    return { ...r, [column]: assignments[String(name).trim()] || r[column] };
  });
  return { rows: coded, store: nextStore, newlyAdded };
}

// --- Serialize / file round-trip --------------------------------------------

export function serializeKeyStore(store) {
  return JSON.stringify(store, null, 2);
}

export function parseKeyStore(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("This file is not a saved code list — it could not be read.");
  }
  if (!obj || typeof obj !== "object" || typeof obj.codes !== "object") {
    throw new Error("This file does not look like a TidyTable code list.");
  }
  const next = Number.isFinite(obj.next) ? obj.next : Object.keys(obj.codes).length + 1;
  return {
    version: KEY_VERSION,
    prefix: typeof obj.prefix === "string" && obj.prefix.trim() ? obj.prefix.trim() : "Prescriber",
    next,
    codes: obj.codes,
  };
}

// --- localStorage (kept apart from the recipe library on purpose) ------------

const STORE_KEY = "tidytable_key_store";

export function loadKeyStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return parseKeyStore(raw);
  } catch {
    return null;
  }
}

export function persistKeyStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  return store;
}
