// Replay (build prompt §7). Take a saved recipe and run its steps on next month's
// file. The rules are the RECORDED ones — replay never re-guesses a cleaning rule
// from the new data. Anything the recorded rules do not cover is surfaced as a
// SURPRISE rather than silently guessed or silently dropped:
//   - a recorded column that no longer fuzzy-matches any header (a rename),
//   - a new spelling variant that folds together with a known category but was
//     not in the recorded merge map,
//   - new people who have never been seen before (they get new stable codes),
//   - rows a rule could not handle.
//
// Replay ends with a plain-language report: the steps applied with row counts at
// each stage, then the surprises, loudly.

import {
  coerceNumbers, sentinelBlanks, parseDates, trimCase, censoredValues, splitList, foldKey, epochSerialToNumber, stripUnitSuffix,
  dedupeEncounterRows, keepOneRowPerPatient,
} from "../checkup/normalizers.js";
import { matchColumn } from "./recipe.js";
import { applyCodesToColumn } from "./keyStore.js";
import { buildReportCards } from "./reportCards.js";
import { fillPlan, summarizeAnswer } from "../offline/fillPlan.js";

const CELL_FNS = { coerceNumbers, sentinelBlanks, parseDates, epochSerialToNumber, stripUnitSuffix };

function rowSignature(row, names) {
  return JSON.stringify(names.map((n) => row[n]));
}

// Apply a recorded merge map to a column, then look for spellings that fold
// together but were left unmerged — those are new category variants no recorded
// rule covers.
function applyMergeAndDetect(rows, column, map) {
  for (const r of rows) r[column] = trimCase(r[column], map || {});
  const groups = new Map(); // foldKey -> Set(spelling)
  for (const r of rows) {
    const v = r[column];
    if (v == null || String(v).trim() === "") continue;
    const k = foldKey(v);
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k).add(String(v));
  }
  const unmerged = [];
  for (const set of groups.values()) {
    if (set.size > 1) unmerged.push([...set]);
  }
  return unmerged;
}

// W3: replay a recorded "question" step (see recipe.js questionStep). The
// recorded `match` names its columns by the header names seen when the
// question was first answered — a rename is exactly the kind of surprise
// replay must never guess past, so every column the match touches is
// fuzzy-matched against the CURRENT headers first, the same way every other
// step type resolves its columns. Any column that no longer matches anything
// stops this step cold (no partial/guessed answer); a value that no longer
// appears in its column is reported too, but the step still runs — a
// COUNTIFS in Excel would honestly return 0 for it as well, not refuse.
function remapColumn(name, headers, missing) {
  const hit = matchColumn(name, headers);
  if (!hit) missing.push(name);
  return hit || name;
}

function remapCondition(cond, headers, missing) {
  const next = { ...cond, column: remapColumn(cond.column, headers, missing) };
  if (cond.when) next.when = { ...cond.when, column: remapColumn(cond.when.column, headers, missing) };
  return next;
}

function remapMatch(match, headers, missing) {
  const next = { ...match, stages: match.stages.map((s) => ({ ...s, condition: remapCondition(s.condition, headers, missing) })) };
  if (match.groupColumn) next.groupColumn = remapColumn(match.groupColumn, headers, missing);
  if (match.aggregation) {
    next.aggregation = {
      targetColumn: remapColumn(match.aggregation.targetColumn, headers, missing),
      groupColumn: match.aggregation.groupColumn ? remapColumn(match.aggregation.groupColumn, headers, missing) : null,
    };
  }
  if (match.grain?.entityColumn) {
    next.grain = { ...match.grain, entityColumn: remapColumn(match.grain.entityColumn, headers, missing) };
  }
  return next;
}

// Every value/set condition the question's match resolved, checked against
// the CURRENT rows — reported plainly (not guessed past) when a value the
// question was built on no longer appears anywhere in its column.
function findMissingValues(match, rows) {
  const missing = [];
  for (const stage of match.stages) {
    const c = stage.condition;
    if (c.kind === "value") {
      const want = foldKey(c.value);
      if (!rows.some((r) => r[c.column] != null && foldKey(r[c.column]) === want)) missing.push({ column: c.column, value: c.value });
    } else if (c.kind === "set") {
      const wanted = new Set(c.values.map(foldKey));
      if (!rows.some((r) => r[c.column] != null && wanted.has(foldKey(r[c.column])))) missing.push({ column: c.column, value: c.values.join(", ") });
    }
  }
  return missing;
}

// recipe: from recipe.js. sheet: { name, headers, rows }. keyStore: from
// keyStore.js (or null to start fresh). Returns a full replay result.
export function replayRecipe(recipe, sheet, keyStore) {
  let rows = sheet.rows.map((r) => ({ ...r }));
  let store = keyStore;
  const headers = sheet.headers;
  const steps = [];
  const surprises = [];
  const logEntries = [];
  const newPeople = [];
  const questionAnswers = [];
  let reportCards = null;

  const record = (label, before, after, extra) =>
    steps.push({ label, rowsBefore: before, rowsAfter: after, ...(extra || {}) });

  for (const step of recipe.steps) {
    const before = rows.length;

    if (step.type === "checkupFix") {
      const fix = step.fix;

      if (fix.normalizer === "dedupeRows") {
        const names = headers.map((h) => h.name);
        const seen = new Set();
        rows = rows.filter((r) => {
          const sig = rowSignature(r, names);
          if (seen.has(sig)) return false;
          seen.add(sig);
          return true;
        });
        const removed = before - rows.length;
        record(step.label, before, rows.length, { note: `${removed} duplicate row${removed === 1 ? "" : "s"} removed` });
        logEntries.push({ action: "Removed duplicate rows", column: null, cellsChanged: 0, rowsBefore: before, rowsAfter: rows.length, rowsRemoved: removed });
        continue;
      }

      // Every other checkup fix targets a column — fuzzy-match it first.
      const col = matchColumn(fix.column, headers);
      if (!col) {
        surprises.push({
          type: "missingColumn",
          column: fix.column,
          message: `The step "${step.label}" could not run: this file has no column matching "${fix.column}". It may have been renamed or removed. Nothing was changed for this step.`,
        });
        record(step.label, before, before, { skipped: true, note: `column "${fix.column}" not found — step skipped` });
        continue;
      }

      if (fix.normalizer === "dedupeEncounters") {
        const names = headers.map((h) => h.name);
        rows = dedupeEncounterRows(rows, names, col);
        const removed = before - rows.length;
        record(step.label, before, rows.length, { note: `${removed} exact-copy row${removed === 1 ? "" : "s"} removed` });
        logEntries.push({ action: `Removed exact-copy rows sharing the same "${col}"`, column: col, cellsChanged: 0, rowsBefore: before, rowsAfter: rows.length, rowsRemoved: removed });
        continue;
      }

      if (fix.normalizer === "keepOnePerPatient") {
        // The surviving-row policy can name a date column — that column must
        // be re-matched against THIS file's headers too, never assumed.
        const parts = String(fix.params?.policy || "firstrow").split("::");
        let policy = parts[0];
        if (parts[1]) {
          const dcol = matchColumn(parts[1], headers);
          if (!dcol) {
            surprises.push({
              type: "missingColumn",
              column: parts[1],
              message: `The step "${step.label}" could not run: this file has no column matching "${parts[1]}", which the recorded rule uses to pick each patient's surviving row. Nothing was changed for this step.`,
            });
            record(step.label, before, before, { skipped: true, note: `column "${parts[1]}" not found — step skipped` });
            continue;
          }
          policy = `${parts[0]}::${dcol}`;
        }
        rows = keepOneRowPerPatient(rows, col, policy, headers.map((h) => h.name));
        const removed = before - rows.length;
        record(step.label, before, rows.length, { note: `${removed} row${removed === 1 ? "" : "s"} removed — one row kept per patient` });
        logEntries.push({ action: `Kept one row per patient in "${col}"`, column: col, cellsChanged: 0, rowsBefore: before, rowsAfter: rows.length, rowsRemoved: removed });
        continue;
      }

      if (fix.normalizer === "trimCase") {
        const unmerged = applyMergeAndDetect(rows, col, fix.params?.map || {});
        for (const variants of unmerged) {
          surprises.push({
            type: "newCategoryVariant",
            column: col,
            variants,
            message: `In "${col}", these spellings mean the same thing but no recorded rule merges them: ${variants.map((v) => `"${v}"`).join(", ")}. They were left as-is. Add a rule for them and run again if they should be merged.`,
          });
        }
        record(step.label, before, before, { note: unmerged.length ? `${unmerged.length} new spelling group${unmerged.length === 1 ? "" : "s"} left for review` : "applied" });
        logEntries.push({ action: `Merged spellings in "${col}"`, column: col, cellsChanged: 0, rowsBefore: before, rowsAfter: before });
        continue;
      }

      if (fix.normalizer === "splitList") {
        const out = [];
        for (const r of rows) {
          for (const part of splitList(r[col])) out.push({ ...r, [col]: part });
        }
        rows = out;
        record(step.label, before, rows.length, { note: `${rows.length - before} row${rows.length - before === 1 ? "" : "s"} added` });
        logEntries.push({ action: `Split multi-value cells in "${col}"`, column: col, cellsChanged: 0, rowsBefore: before, rowsAfter: rows.length, rowsAdded: rows.length - before });
        continue;
      }

      // Plain per-cell normalizers.
      let changed = 0;
      const fn = CELL_FNS[fix.normalizer];
      const policy = fix.params?.policy || "boundary";
      for (const r of rows) {
        const b = r[col];
        const a = fix.normalizer === "censoredValues" ? censoredValues(b, policy)
          : fix.normalizer === "sentinelBlanks" ? sentinelBlanks(b)
            : fix.normalizer === "parseDates" ? parseDates(b, fix.params?.order || "MDY")
              : fn ? fn(b) : b;
        if (a !== b) { r[col] = a; changed++; }
      }
      record(step.label, before, before, { note: `${changed} cell${changed === 1 ? "" : "s"} changed` });
      logEntries.push({ action: step.label, column: col, cellsChanged: changed, rowsBefore: before, rowsAfter: before });
      continue;
    }

    if (step.type === "deidentify") {
      const col = matchColumn(step.column, headers);
      if (!col) {
        surprises.push({
          type: "missingColumn",
          column: step.column,
          message: `The step "${step.label}" could not run: this file has no column matching "${step.column}". Nothing was coded for this step.`,
        });
        record(step.label, before, before, { skipped: true, note: `column "${step.column}" not found — step skipped` });
        continue;
      }
      const res = applyCodesToColumn(store || { version: 1, prefix: "Prescriber", next: 1, codes: {} }, rows, col);
      rows = res.rows;
      store = res.store;
      if (res.newlyAdded.length) {
        for (const p of res.newlyAdded) newPeople.push(p);
        surprises.push({
          type: "newPeople",
          column: col,
          people: res.newlyAdded,
          message: `${res.newlyAdded.length} new ${res.newlyAdded.length === 1 ? "person" : "people"} in "${col}" had no code yet and ${res.newlyAdded.length === 1 ? "was" : "were"} given ${res.newlyAdded.length === 1 ? "code" : "codes"} ${res.newlyAdded.map((p) => p.code).join(", ")}. These codes stay the same next month so you can track each person over time.`,
        });
      }
      record(step.label, before, before, { note: res.newlyAdded.length ? `${res.newlyAdded.length} new code${res.newlyAdded.length === 1 ? "" : "s"} assigned` : "all people already coded" });
      logEntries.push({ action: `Swapped names for codes in "${col}"`, column: col, cellsChanged: rows.length, rowsBefore: before, rowsAfter: before });
      continue;
    }

    if (step.type === "question") {
      const missingColumns = [];
      const remapped = remapMatch(step.match, headers, missingColumns);
      if (missingColumns.length) {
        const uniq = [...new Set(missingColumns)];
        surprises.push({
          type: "missingColumn",
          column: uniq[0],
          message: `The question "${step.request}" could not be answered: this file has no column matching ${uniq.map((m) => `"${m}"`).join(", ")}. It may have been renamed or removed. Nothing was computed for this step.`,
        });
        record(step.label, before, before, { skipped: true, note: `column not found — step skipped` });
        continue;
      }
      remapped.sheetName = sheet.name;
      const missingValues = findMissingValues(remapped, rows);
      for (const mv of missingValues) {
        surprises.push({
          type: "missingValue",
          column: mv.column,
          message: `The question "${step.request}" looks for "${mv.value}" in "${mv.column}", but this file has no matching value there. The count for this step is 0, not guessed.`,
        });
      }
      try {
        const { resultRows, exec } = fillPlan(remapped, { sheets: [{ name: sheet.name, rows, headers }] });
        const answer = summarizeAnswer(remapped, exec);
        record(step.label, before, before, { note: answer });
        logEntries.push({ action: `Answered: "${step.request}"`, column: null, cellsChanged: 0, rowsBefore: before, rowsAfter: before });
        questionAnswers.push({ request: step.request, answer, resultRows });
      } catch (err) {
        surprises.push({
          type: "questionFailed",
          message: `The question "${step.request}" could not be answered on this file: ${err?.message || "something went wrong"}. Nothing was guessed.`,
        });
        record(step.label, before, before, { skipped: true, note: "could not be answered — step skipped" });
      }
      continue;
    }

    if (step.type === "reportCards") {
      const person = matchColumn(step.personColumn, headers);
      if (!person) {
        surprises.push({
          type: "missingColumn",
          column: step.personColumn,
          message: `Report cards could not be made: this file has no column matching "${step.personColumn}".`,
        });
        record(step.label, before, before, { skipped: true });
        continue;
      }
      // A recorded value/group column that no longer matches is a rename, not a
      // reason to quietly change the metric. Announce it and say what happened
      // instead (fall back to row counts / no grouping, but never silently).
      let value = null;
      if (step.valueColumn) {
        value = matchColumn(step.valueColumn, headers);
        if (!value) {
          surprises.push({
            type: "missingColumn",
            column: step.valueColumn,
            message: `The report cards were set to compare total "${step.valueColumn}", but this file has no column matching it — it may have been renamed or removed. The cards now count rows for each person instead. Rename the column back or update the recipe if you want totals.`,
          });
        }
      }
      let group = null;
      if (step.groupColumn) {
        group = matchColumn(step.groupColumn, headers);
        if (!group) {
          surprises.push({
            type: "missingColumn",
            column: step.groupColumn,
            message: `The report cards were set to group people by "${step.groupColumn}", but this file has no column matching it — it may have been renamed or removed. The cards are made without that grouping.`,
          });
        }
      }
      // The key is deliberately NOT passed here — report output cannot hold a name.
      reportCards = buildReportCards(rows, { personColumn: person, valueColumn: value, groupColumn: group });
      for (const w of reportCards.warnings) {
        surprises.push({ type: "smallCell", message: w.message });
      }
      record(step.label, before, before, { note: `${reportCards.cards.length} card${reportCards.cards.length === 1 ? "" : "s"} made` });
      continue;
    }

    // Unknown step type — never guess.
    surprises.push({ type: "unknownStep", message: `A step of an unknown kind was skipped.` });
    record(step.label || "Unknown step", before, before, { skipped: true });
  }

  return { rows, keyStore: store, steps, surprises, newPeople, reportCards, logEntries, questionAnswers };
}

// Plain-language replay report for on-screen display and export.
export function formatReplayReport(recipe, result, fileName) {
  const lines = [`Replay of recipe "${recipe.name}" on ${fileName || "your file"}`, ""];
  lines.push("Steps applied:");
  for (const s of result.steps) {
    const arrow = s.rowsBefore === s.rowsAfter ? `${s.rowsAfter} rows` : `${s.rowsBefore} to ${s.rowsAfter} rows`;
    lines.push(`- ${s.label}${s.skipped ? " (skipped)" : ""} — ${arrow}${s.note ? `, ${s.note}` : ""}`);
  }
  lines.push("");
  if (result.surprises.length === 0) {
    lines.push("No surprises: every recorded rule covered this file.");
  } else {
    lines.push(`Surprises that need your attention (${result.surprises.length}):`);
    for (const s of result.surprises) lines.push(`- ${s.message}`);
  }
  lines.push("");
  return lines.join("\n").trimEnd() + "\n";
}
