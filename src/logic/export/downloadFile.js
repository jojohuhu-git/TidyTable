// Shared by every P5-4 export (docx and pptx): trigger a browser download
// from an in-memory Blob, and turn a title/label into a safe file name.

export function sanitizeFileBase(name) {
  const base = String(name || "TidyTable_export")
    .replace(/[\\/:*?"<>|]/g, " ")
    .trim()
    .slice(0, 80);
  return base || "TidyTable_export";
}

export function downloadBlob(blob, fileName) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}
