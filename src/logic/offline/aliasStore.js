// Phase 3 (plan-2026-07-10-offline-smarts.md) — learned column aliases.
//
// When the user confirms a "did you mean this column?" chip ("treatment length"
// -> Duration_days), we remember that mapping so the SAME wording is an exact
// hit next time, with no chip to click. This store is the persistent partner of
// the session-only aliasMap in App.jsx.
//
// PRIVACY BOUNDARY (a product guarantee — see CLAUDE.md): this store may hold
// only SCHEMA — column names and the folded phrase the user typed — never cell
// VALUES. Value confirmations ("e coli" -> "ESCHERICHIA COLI") stay in the
// in-memory session map and are deliberately NOT persisted here, because a cell
// value is data. Aliases are filed per file "signature" (the sorted set of
// folded column keys), the same way recipes match a file by its columns, so an
// alias learned for one spreadsheet's shape doesn't bleed onto an unrelated one.

import { columnKey } from "../recipes/recipe.js";
import { foldKey } from "../checkup/normalizers.js";

export const ALIAS_STORE_VERSION = 1;
const STORE_KEY = "tidytable_column_aliases";

export function emptyAliasStore() {
  return { version: ALIAS_STORE_VERSION, files: {} };
}

// A stable fingerprint of a file's SHAPE: its column names, folded and sorted so
// column order or casing doesn't matter. Contains no cell data.
export function fileSignature(headers) {
  const keys = (headers || [])
    .map((h) => columnKey(h.name))
    .filter(Boolean)
    .sort();
  return keys.join("|");
}

// The folded phrase the user typed, used as the alias key — matches the session
// aliasMap's keying (foldKey) so the two layers agree.
export function aliasKey(phrase) {
  return foldKey(phrase);
}

// The learned aliases for one file shape, as a plain { foldedPhrase: columnName }
// object the matcher can look up directly.
export function columnAliasesFor(store, signature) {
  if (!store || !signature) return {};
  const entry = store.files?.[signature];
  return entry && typeof entry === "object" ? { ...entry } : {};
}

// Remember phrase -> column for a file shape, returning a NEW store (never
// mutates the input). Only the column name is stored — no cell value ever
// reaches this store.
export function rememberColumnAlias(store, signature, phrase, columnName) {
  const base = store && store.files ? store : emptyAliasStore();
  const key = aliasKey(phrase);
  if (!signature || !key || !columnName) return base;
  const files = { ...base.files };
  files[signature] = { ...(files[signature] || {}), [key]: columnName };
  return { version: ALIAS_STORE_VERSION, files };
}

// Forget a learned alias (e.g. the column was renamed / the guess was wrong).
export function forgetColumnAlias(store, signature, phrase) {
  const base = store && store.files ? store : emptyAliasStore();
  const key = aliasKey(phrase);
  const forShape = base.files?.[signature];
  if (!forShape || !(key in forShape)) return base;
  const nextShape = { ...forShape };
  delete nextShape[key];
  const files = { ...base.files, [signature]: nextShape };
  return { version: ALIAS_STORE_VERSION, files };
}

// --- localStorage round-trip (kept apart from recipes / key store) -----------

export function loadAliasStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyAliasStore();
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || typeof obj.files !== "object") return emptyAliasStore();
    return { version: ALIAS_STORE_VERSION, files: obj.files };
  } catch {
    return emptyAliasStore();
  }
}

export function persistAliasStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store || emptyAliasStore()));
  } catch {
    // storage full / unavailable — aliases are a convenience, never critical.
  }
  return store;
}
