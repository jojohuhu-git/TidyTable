// The recipe shelf (build prompt §8): the multi-step data moves the owner needs
// that are more than a single count. Each is a pure function over row arrays, and
// each follows the house rule — never guess, never silently drop. When something
// doesn't line up (a list pair of unequal length, an event with no valid prior),
// the row is flagged and returned for the user to see, not quietly discarded.

import { foldKey } from "../checkup/normalizers.js";

const keyOf = (row, col) => (row[col] == null ? null : foldKey(row[col]));

// Rows in A whose key is NOT present in B (anti-join). Useful for "which patients
// in this month's file are missing from last month's".
export function antiJoin(rowsA, rowsB, keyCol) {
  const inB = new Set(rowsB.map((r) => keyOf(r, keyCol)).filter((k) => k != null));
  return rowsA.filter((r) => {
    const k = keyOf(r, keyCol);
    return k != null && !inB.has(k);
  });
}

// Left join: each A row keeps its columns and gains `bringCols` from the matching
// B row by key (e.g. look up each drug's class). Rows with no match are kept with
// the brought columns left blank and are also reported in `unmatched`.
export function leftJoinLookup(rowsA, rowsB, keyCol, bringCols) {
  const lookup = new Map();
  for (const r of rowsB) {
    const k = keyOf(r, keyCol);
    if (k != null && !lookup.has(k)) lookup.set(k, r);
  }
  const unmatched = [];
  const rows = rowsA.map((r) => {
    const k = keyOf(r, keyCol);
    const match = k != null ? lookup.get(k) : null;
    const add = {};
    for (const c of bringCols) add[c] = match ? match[c] : null;
    if (!match) unmatched.push(r);
    return { ...r, ...add };
  });
  return { rows, unmatched };
}

// Explode paired list cells (e.g. a "Drug" cell "amox, cipro" paired with a
// "Dose" cell "500, 250") into one row per pair. If the two cells have different
// numbers of items, the row is NOT split (guessing the pairing is banned) — it is
// returned in `mismatched` for the user to fix.
export function explodePairedLists(rows, colX, colY, sep = /[,;]/) {
  const out = [];
  const mismatched = [];
  const split = (v) => (v == null ? [] : String(v).split(sep).map((s) => s.trim()).filter((s) => s !== ""));
  for (const r of rows) {
    const xs = split(r[colX]);
    const ys = split(r[colY]);
    if (xs.length <= 1 && ys.length <= 1) { out.push(r); continue; }
    if (xs.length !== ys.length) { mismatched.push(r); continue; }
    for (let i = 0; i < xs.length; i++) out.push({ ...r, [colX]: xs[i], [colY]: ys[i] });
  }
  return { rows: out, mismatched };
}

// As-of join: match each event to the most recent prior event for the same person
// at or before the event's time. Events with no valid prior are flagged, never
// dropped. `bringCols` are the prior columns copied onto the event (prefixed).
export function asOfJoin(events, priors, keyCol, timeCol, bringCols, prefix = "prior_") {
  const byKey = new Map();
  for (const p of priors) {
    const k = keyOf(p, keyCol);
    if (k == null) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  for (const list of byKey.values()) list.sort((a, b) => time(a[timeCol]) - time(b[timeCol]));

  const unmatched = [];
  const rows = events.map((e) => {
    const k = keyOf(e, keyCol);
    const t = time(e[timeCol]);
    const list = k != null ? byKey.get(k) || [] : [];
    let best = null;
    for (const p of list) {
      if (time(p[timeCol]) <= t) best = p;
      else break;
    }
    const add = {};
    for (const c of bringCols) add[prefix + c] = best ? best[c] : null;
    if (!best) unmatched.push(e);
    return { ...e, ...add };
  });
  return { rows, unmatched };
}

function time(v) {
  const t = Date.parse(v);
  return Number.isNaN(t) ? -Infinity : t;
}

// Reshape one-row-per-visit → one-row-per-patient: for each id, spread the values
// of `valueCol` across new columns named by `keyCol`. Later visits overwrite
// earlier for the same key (reported via `collisions` count).
export function reshapeLongToWide(rows, idCol, keyCol, valueCol) {
  const byId = new Map();
  const keys = [];
  let collisions = 0;
  for (const r of rows) {
    const id = r[idCol];
    if (id == null) continue;
    const idk = foldKey(id);
    if (!byId.has(idk)) byId.set(idk, { [idCol]: id });
    const rec = byId.get(idk);
    const key = String(r[keyCol]);
    if (!keys.includes(key)) keys.push(key);
    if (rec[key] !== undefined) collisions++;
    rec[key] = r[valueCol];
  }
  return { rows: [...byId.values()], columns: [idCol, ...keys], collisions };
}

// Reshape one-row-per-patient → one-row-per-visit (wide → long): turn the given
// value columns into (key, value) rows, dropping empties.
export function reshapeWideToLong(rows, idCol, valueCols, keyName = "measure", valueName = "value") {
  const out = [];
  for (const r of rows) {
    for (const c of valueCols) {
      const v = r[c];
      if (v == null || String(v).trim() === "") continue;
      out.push({ [idCol]: r[idCol], [keyName]: c, [valueName]: v });
    }
  }
  return out;
}
