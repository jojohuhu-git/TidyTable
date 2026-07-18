// P5-1: "Copy table for Word" — result tables (including Table 1) leave the
// app as REAL table structure. Writing text/html to the clipboard is what
// makes Word/PowerPoint paste rows and columns instead of a blob of
// tab-separated text; the text/plain twin is the fallback for anything that
// can't take HTML. Zero dependencies — plain string building plus the
// standard clipboard API. Copies EVERY row, not just the 200 the on-screen
// table caps at, same as the .xlsx/.csv downloads.

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(v) {
  return v == null ? "" : String(v);
}

export function buildTableHtml(rows, columns) {
  if (!rows || rows.length === 0) return "";
  const cols = columns && columns.length ? columns : Object.keys(rows[0]);
  const head = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = rows
    .map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(cell(r[c]))}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function buildTableText(rows, columns) {
  if (!rows || rows.length === 0) return "";
  const cols = columns && columns.length ? columns : Object.keys(rows[0]);
  const lines = [cols.join("\t"), ...rows.map((r) => cols.map((c) => cell(r[c])).join("\t"))];
  return lines.join("\n");
}

// Returns { ok, message } and never pretends: if this browser can't write
// HTML to the clipboard, it says so and points at the downloads that work.
export async function copyTableForWord(rows, columns) {
  const html = buildTableHtml(rows, columns);
  if (!html) return { ok: false, message: "Nothing to copy — the table is empty." };
  const text = buildTableText(rows, columns);
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return { ok: false, message: "Copying a formatted table isn't available in this browser — use Download Excel or CSV instead." };
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return { ok: true, message: "Copied — paste into Word or PowerPoint and it stays a real table." };
  } catch {
    return { ok: false, message: "Couldn't copy the table — your browser blocked it. Use Download Excel or CSV instead." };
  }
}
