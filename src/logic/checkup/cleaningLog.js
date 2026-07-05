// Cleaning log v1 (build prompt §7). A cumulative, plain-English record of every
// change made this session: what was changed, row counts before and after, and
// how many rows were dropped or added. This is the user's defensibility trail.
// Phase 2 extends it (recipes/replay); every module appends to this same shape.

// One "apply" produces an event; the session log is a list of events.
export function makeLogEvent({ fileName, sheet, entries }) {
  return { at: new Date().toISOString(), fileName, sheet, entries };
}

function describeEntry(e) {
  const bits = [`- ${e.action}`];
  if (e.cellsChanged) bits.push(`(${e.cellsChanged} cell${e.cellsChanged === 1 ? "" : "s"} changed)`);
  if (e.rowsRemoved) bits.push(`— ${e.rowsRemoved} row${e.rowsRemoved === 1 ? "" : "s"} removed, ${e.rowsBefore} to ${e.rowsAfter}`);
  if (e.rowsAdded) bits.push(`— ${e.rowsAdded} row${e.rowsAdded === 1 ? "" : "s"} added, ${e.rowsBefore} to ${e.rowsAfter}`);
  return bits.join(" ");
}

// Render the whole session log as plain text for on-screen display and export.
export function formatCleaningLog(events) {
  if (!events || events.length === 0) return "No changes have been made yet.";
  const lines = ["TidyTable cleaning log", ""];
  for (const ev of events) {
    lines.push(`File: ${ev.fileName}  ·  Sheet: ${ev.sheet}  ·  ${ev.at.slice(0, 16).replace("T", " ")}`);
    if (ev.entries.length === 0) {
      lines.push("- (no changes)");
    } else {
      for (const e of ev.entries) lines.push(describeEntry(e));
      const last = ev.entries[ev.entries.length - 1];
      lines.push(`  Result: ${last.rowsAfter} rows.`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
