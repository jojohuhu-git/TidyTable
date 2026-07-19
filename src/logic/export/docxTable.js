// P5-4: journal-style Word table — three horizontal rules (above the
// header, below the header, below the last row), no vertical lines
// anywhere. Same rows/columns contract as tableHtml.js's buildTableHtml
// (row-level data, columns default to Object.keys of the first row) so
// this can render the exact same table the app already shows on screen
// and offers as Excel/CSV. docx is dynamically imported here, not at
// module top level, so it never enters the main app bundle until this
// function actually runs.

function cellText(v) {
  return v == null ? "" : String(v);
}

export async function buildJournalTable(rows, columns) {
  if (!rows || rows.length === 0) return null;
  const { Table, TableRow, TableCell, Paragraph, TextRun, BorderStyle, WidthType } = await import("docx");
  const cols = columns && columns.length ? columns : Object.keys(rows[0]);

  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const rule = (size) => ({ style: BorderStyle.SINGLE, size, color: "000000" });

  function makeCell(text, { bold = false, top, bottom } = {}) {
    return new TableCell({
      borders: { top: top ?? none, bottom: bottom ?? none, left: none, right: none },
      children: [new Paragraph({ children: [new TextRun({ text: cellText(text), bold })] })],
    });
  }

  const headerRow = new TableRow({
    children: cols.map((c) => makeCell(c, { bold: true, top: rule(6), bottom: rule(4) })),
  });

  const bodyRows = rows.map((r, i) => {
    const isLast = i === rows.length - 1;
    return new TableRow({
      children: cols.map((c) => makeCell(r[c], { bottom: isLast ? rule(6) : undefined })),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [headerRow, ...bodyRows],
  });
}
