// Phase 7.7 (plan-2026-07-10-offline-smarts.md) — grain memory.
//
// A per-entity question over repeating rows ("how many patients…") asks whether
// to combine each patient's rows first, or count rows as they are. That choice
// almost never changes for a given file — re-asking it every question is a
// papercut. This store remembers the choice per file SIGNATURE + entity column
// (the same signature recipes/aliases use), so we ask once and thereafter apply
// the remembered grain, with a small "change" affordance in the UI.
//
// PRIVACY BOUNDARY (product guarantee, see CLAUDE.md): this store holds only
// SCHEMA — the file signature, the entity COLUMN name, and the chosen mode
// ("row" | "group-then-test"). Never a cell value.

export const GRAIN_STORE_VERSION = 1;
const STORE_KEY = "tidytable_grain_choices";

export function emptyGrainStore() {
  return { version: GRAIN_STORE_VERSION, files: {} };
}

// The remembered grain choices for one file shape, as { entityColumn: mode }.
export function grainChoicesFor(store, signature) {
  if (!store || !signature) return {};
  const entry = store.files?.[signature];
  return entry && typeof entry === "object" ? { ...entry } : {};
}

// The remembered mode for one signature + entity column, or null.
export function grainChoiceFor(store, signature, entityColumn) {
  if (!signature || !entityColumn) return null;
  const forShape = store?.files?.[signature];
  return forShape && forShape[entityColumn] ? forShape[entityColumn] : null;
}

// Remember entityColumn -> mode for a file shape, returning a NEW store. `mode`
// must be "row" or "group-then-test"; anything else is ignored.
export function rememberGrainChoice(store, signature, entityColumn, mode) {
  const base = store && store.files ? store : emptyGrainStore();
  if (!signature || !entityColumn || (mode !== "row" && mode !== "group-then-test")) return base;
  const files = { ...base.files };
  files[signature] = { ...(files[signature] || {}), [entityColumn]: mode };
  return { version: GRAIN_STORE_VERSION, files };
}

// Forget a remembered choice (the user clicked "change").
export function forgetGrainChoice(store, signature, entityColumn) {
  const base = store && store.files ? store : emptyGrainStore();
  const forShape = base.files?.[signature];
  if (!forShape || !(entityColumn in forShape)) return base;
  const nextShape = { ...forShape };
  delete nextShape[entityColumn];
  return { version: GRAIN_STORE_VERSION, files: { ...base.files, [signature]: nextShape } };
}

export function loadGrainStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyGrainStore();
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || typeof obj.files !== "object") return emptyGrainStore();
    return { version: GRAIN_STORE_VERSION, files: obj.files };
  } catch {
    return emptyGrainStore();
  }
}

export function persistGrainStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store || emptyGrainStore()));
  } catch {
    // storage full / unavailable — a convenience, never critical.
  }
  return store;
}
