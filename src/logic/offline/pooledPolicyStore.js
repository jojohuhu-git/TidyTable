// P1-4a (2026-07-16) — pooled-ranking counting-policy memory.
//
// "Most common value across Primary Dx and Secondary Dx" has three honest
// answers depending on how a repeat is counted (Decision D, owner-approved
// 2026-07-11): every occurrence, once per row, or once per patient. That
// choice almost never changes for a given file + column pair — re-asking it
// every question is the same papercut grainStore.js already solves for grain
// mode, so this store mirrors its shape exactly.
//
// PRIVACY BOUNDARY (product guarantee, see CLAUDE.md): this store holds only
// SCHEMA — the file signature, the pooled column names, the chosen policy
// ("occurrence" | "row" | "patient"), and (for "patient") the entity column
// name. Never a cell value.

export const POOLED_POLICY_STORE_VERSION = 1;
const STORE_KEY = "tidytable_pooled_policy_choices";
const VALID_POLICIES = new Set(["occurrence", "row", "patient"]);

export function emptyPooledPolicyStore() {
  return { version: POOLED_POLICY_STORE_VERSION, files: {} };
}

// The pool key identifies WHICH set of columns a policy choice applies to —
// two different column pairs in the same file can have different answers.
export function poolKeyFor(columns) {
  return columns.slice().sort().join("|");
}

// The remembered { policy, entityColumn } for one signature + pool key, or null.
export function pooledPolicyFor(store, signature, columns) {
  if (!signature || !columns || !columns.length) return null;
  const entry = store?.files?.[signature]?.[poolKeyFor(columns)];
  return entry && VALID_POLICIES.has(entry.policy) ? { ...entry } : null;
}

// All remembered choices for one file shape, as { poolKey: { policy, entityColumn } }
// — the shape matchRequest's options.pooledPolicyChoices expects.
export function pooledPolicyChoicesFor(store, signature) {
  if (!store || !signature) return {};
  const entry = store.files?.[signature];
  return entry && typeof entry === "object" ? { ...entry } : {};
}

// Remember policy (+ entityColumn, for "patient") for a file shape + pool key,
// returning a NEW store.
export function rememberPooledPolicy(store, signature, columns, policy, entityColumn) {
  const base = store && store.files ? store : emptyPooledPolicyStore();
  if (!signature || !columns || !columns.length || !VALID_POLICIES.has(policy)) return base;
  const key = poolKeyFor(columns);
  const files = { ...base.files };
  files[signature] = { ...(files[signature] || {}), [key]: { policy, entityColumn: entityColumn || null } };
  return { version: POOLED_POLICY_STORE_VERSION, files };
}

// Forget a remembered choice (the user clicked "change").
export function forgetPooledPolicy(store, signature, columns) {
  const base = store && store.files ? store : emptyPooledPolicyStore();
  const key = poolKeyFor(columns);
  const forShape = base.files?.[signature];
  if (!forShape || !(key in forShape)) return base;
  const nextShape = { ...forShape };
  delete nextShape[key];
  return { version: POOLED_POLICY_STORE_VERSION, files: { ...base.files, [signature]: nextShape } };
}

export function loadPooledPolicyStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyPooledPolicyStore();
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || typeof obj.files !== "object") return emptyPooledPolicyStore();
    return { version: POOLED_POLICY_STORE_VERSION, files: obj.files };
  } catch {
    return emptyPooledPolicyStore();
  }
}

export function persistPooledPolicyStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store || emptyPooledPolicyStore()));
  } catch {
    // storage full / unavailable — a convenience, never critical.
  }
  return store;
}
