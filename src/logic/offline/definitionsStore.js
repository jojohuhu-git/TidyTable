// B7: an in-app alternative to the Excel-round-trip for supplying clinical
// meaning. A blocked "needs_definitions" question is the app's highest-
// friction moment (open Excel, add a Definitions tab, save, re-upload,
// retype the question); this store lets the user type the meaning right
// there and re-run immediately, while still fully honoring a real
// Definitions sheet if one exists (mergeDefinitions below).

import { termKey } from "./definitions.js";

export function emptyDefinitionsStore() {
  return { entries: [] };
}

// Adding a term the store already has replaces the old entry — the user is
// correcting/updating what they told the app, not stacking duplicates.
export function addDefinitionEntry(store, entry) {
  const key = termKey(entry.term);
  const withoutOld = (store?.entries || []).filter((e) => termKey(e.term) !== key);
  return { entries: [...withoutOld, entry] };
}

export function removeDefinitionEntry(store, term) {
  const key = termKey(term);
  return { entries: (store?.entries || []).filter((e) => termKey(e.term) !== key) };
}

// Merge the in-app store on top of a Definitions-sheet lookup. A term typed
// into the store just now is more current than a possibly-stale sheet row,
// so the store wins on a collision.
export function mergeDefinitions(sheetDefs, store) {
  const byTerm = new Map(sheetDefs?.byTerm || []);
  for (const entry of store?.entries || []) {
    byTerm.set(termKey(entry.term), entry);
  }
  return { present: Boolean(sheetDefs?.present) || (store?.entries?.length || 0) > 0, byTerm };
}

export function serializeDefinitionsStore(store) {
  return JSON.stringify({ version: 1, entries: store?.entries || [] }, null, 2);
}

export function parseDefinitionsStoreFile(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("This file does not look like a TidyTable definitions export (not valid JSON).");
  }
  if (!obj || !Array.isArray(obj.entries)) {
    throw new Error("This file does not look like a TidyTable definitions export (no entries list).");
  }
  return { entries: obj.entries };
}
