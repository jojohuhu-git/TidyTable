// P5-4: Word (.docx) export. Client-side only, nothing leaves the browser —
// docx is dynamically imported so it never enters the main bundle until an
// export actually runs. Ships the row-level result table (same data as the
// on-screen table / Excel / CSV download), NOT an aggregated
// mean(SD)/n(%)-per-variable summary table — that's a separately-scoped
// future item, per the owner's 2026-07-19 decision.

import { buildJournalTable } from "./docxTable.js";
import { sanitizeFileBase, downloadBlob } from "./downloadFile.js";

// One section's worth of docx content for a single result: a heading, an
// optional note paragraph (the card's plain-English summary), and the
// journal-style table. Returns [] when there are no rows — callers should
// skip a rows-less result rather than emit an empty table.
export async function buildResultSection({ title, note, rows, columns }) {
  const { Paragraph, HeadingLevel } = await import("docx");
  const table = await buildJournalTable(rows, columns);
  if (!table) return [];
  const children = [new Paragraph({ text: title || "Result table", heading: HeadingLevel.HEADING_2 })];
  if (note) children.push(new Paragraph({ text: note }));
  children.push(table);
  return children;
}

// "Send to Word" on a single result card — covers the spec's "Table 1 ->
// manuscript directly."
export async function exportResultToWord({ title, note, rows, columns, fileName }) {
  const section = await buildResultSection({ title, note, rows, columns });
  if (section.length === 0) {
    return { ok: false, message: "Nothing to export — the result table is empty." };
  }
  const { Document, Packer } = await import("docx");
  const doc = new Document({ sections: [{ children: section }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${sanitizeFileBase(fileName || title)}.docx`);
  return { ok: true, message: "Downloaded — open it in Word." };
}

// A result card is one of: a compound "and" question (plan.parts, each part
// with its own rows — the top-level resultRows is [] and unused), or a plain
// question/fix with resultRows directly. Either way, break it into one
// {title, note, rows} per table the committee report should show.
function sectionsForResult(r) {
  if (!r.plan) return [];
  if (r.plan.parts) {
    return r.plan.parts.map((part, i) => ({
      title: `${r.label} — part ${i + 1}`,
      note: part.plan?.summary,
      rows: part.rows,
    }));
  }
  return [{ title: r.label, note: r.plan.summary, rows: r.resultRows }];
}

// P4-5: the committee report. Builds every result card's table into one
// Word doc, oldest first (results are stored newest-first for the on-screen
// list, but a report reads better in the order things happened), a page
// break between each. Cards with no full detail (a page refresh dropped
// plan/resultRows — see ResultsListPanel) are silently skipped, same as the
// on-screen list already does; a card whose table has zero rows is also
// skipped rather than emitting an empty table.
export async function buildReportChildren(results) {
  const { Paragraph, PageBreak } = await import("docx");
  const children = [];
  let sectionCount = 0;
  for (const r of [...results].reverse()) {
    for (const { title, note, rows } of sectionsForResult(r)) {
      const section = await buildResultSection({ title, note, rows });
      if (section.length === 0) continue;
      if (sectionCount > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(...section);
      sectionCount++;
    }
  }
  return { children, sectionCount };
}

// "Export all results" -> a Word committee report, one table per card.
export async function exportAllResultsToWord(results, fileName = "TidyTable_committee_report") {
  const { children, sectionCount } = await buildReportChildren(results);
  if (sectionCount === 0) {
    return { ok: false, message: "Nothing to export yet — answer a question or apply a fix first." };
  }
  const { Document, Packer } = await import("docx");
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${sanitizeFileBase(fileName)}.docx`);
  const tableWord = sectionCount === 1 ? "table" : "tables";
  return { ok: true, message: `Downloaded a report with ${sectionCount} ${tableWord} — open it in Word.` };
}
