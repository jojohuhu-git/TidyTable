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

// P4-1: next month's export routinely adds or renames ONE column, which changes
// the signature entirely even though every learned word still applies. Instead
// of requiring an exact signature match, we accept a NEAR match — the number of
// columns that differ between the remembered shape and the current one — and
// let the caller check the target column still exists. A distance of 2 covers
// "added one column" (diff 1) and "renamed one column" (diff 2: old key gone,
// new key added). Anything further apart is treated as a genuinely different
// file, so an unrelated sheet that happens to share one column name still does
// not inherit another file's learned words.
export const NEAR_MATCH_MAX_DISTANCE = 2;

export function signatureDistance(sigA, sigB) {
  const a = new Set(sigA ? String(sigA).split("|").filter(Boolean) : []);
  const b = new Set(sigB ? String(sigB).split("|").filter(Boolean) : []);
  let diff = 0;
  for (const k of a) if (!b.has(k)) diff++;
  for (const k of b) if (!a.has(k)) diff++;
  return diff;
}

// The folded phrase the user typed, used as the alias key — matches the session
// aliasMap's keying (foldKey) so the two layers agree.
export function aliasKey(phrase) {
  return foldKey(phrase);
}

// The learned aliases that apply to the CURRENT file, as a plain
// { foldedPhrase: columnName } object the matcher can look up directly.
// Looks across every remembered file shape (not just an exact signature
// match) so adding or renaming one column doesn't silently forget every
// learned word (P4-1) — but a shape too far from the current one (a
// genuinely different file) is skipped entirely, and a phrase that would
// resolve to two different, still-present columns from two near-matching
// shapes is dropped rather than guessed.
export function columnAliasesFor(store, headers) {
  if (!store || !Array.isArray(headers) || !headers.length) return {};
  const currentSignature = fileSignature(headers);
  const hasCol = (name) => headers.some((h) => h.name === name);

  const candidatesByPhrase = new Map();
  for (const [storedSignature, phraseMap] of Object.entries(store.files || {})) {
    const dist = signatureDistance(storedSignature, currentSignature);
    if (dist > NEAR_MATCH_MAX_DISTANCE) continue;
    if (!phraseMap || typeof phraseMap !== "object") continue;
    for (const [phrase, column] of Object.entries(phraseMap)) {
      if (!column || !hasCol(column)) continue;
      const list = candidatesByPhrase.get(phrase) || [];
      list.push({ column, dist });
      candidatesByPhrase.set(phrase, list);
    }
  }

  const result = {};
  for (const [phrase, list] of candidatesByPhrase) {
    const minDist = Math.min(...list.map((c) => c.dist));
    const nearest = new Set(list.filter((c) => c.dist === minDist).map((c) => c.column));
    if (nearest.size === 1) result[phrase] = [...nearest][0];
    // else: still ambiguous even after nearest-signature tie-break — decline.
  }
  return result;
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
