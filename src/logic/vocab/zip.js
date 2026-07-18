// P4-3: a minimal READ-ONLY .zip reader, so the app can look inside an .xlsx
// (which is a zip of XML files) for the data-validation picklists that the
// spreadsheet library (SheetJS Community Edition) never surfaces. Zero
// dependencies: stored entries are sliced directly, deflated entries are
// inflated with the browser/node built-in DecompressionStream. Nothing here
// writes or modifies zips.

const EOCD_SIG = 0x06054b50; // "end of central directory" record
const CENTRAL_SIG = 0x02014b50; // one central-directory entry per file
const LOCAL_SIG = 0x04034b50; // local header sitting just before each file's bytes

// List the files inside a zip buffer. Returns [{ name, method, compressedSize,
// size, localOffset }] — method 0 = stored, 8 = deflated. Throws a plain-English
// error if the buffer is not a zip we can read.
export function zipEntries(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // The end-of-central-directory record is at the very end of the file,
  // possibly followed by a comment (max 65535 bytes) — scan backwards for it.
  let eocd = -1;
  const scanStart = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This file doesn't look like a zip archive (no end-of-directory record).");

  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder();
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL_SIG) {
      throw new Error("This zip archive's directory is damaged or uses a format we can't read.");
    }
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("This zip archive is too large to read (zip64 format).");
    }
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Read one entry (from zipEntries) as UTF-8 text.
export async function readZipEntryText(buffer, entry) {
  const view = new DataView(buffer);
  if (view.getUint32(entry.localOffset, true) !== LOCAL_SIG) {
    throw new Error(`The zip entry "${entry.name}" is damaged (bad local header).`);
  }
  // The local header repeats name/extra with its OWN lengths (the extra field
  // often differs from the central directory's copy) — read them locally.
  const nameLen = view.getUint16(entry.localOffset + 26, true);
  const extraLen = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const packed = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.method === 0) return new TextDecoder().decode(packed);
  if (entry.method === 8) {
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  }
  throw new Error(`The zip entry "${entry.name}" uses a compression method we can't read (method ${entry.method}).`);
}
