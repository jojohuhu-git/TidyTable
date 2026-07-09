// Runs AI-generated transform code in a Web Worker, with a timeout, on the FULL
// local dataset. The data never leaves the browser here. A worker has no DOM,
// but it is NOT a security sandbox: it still has fetch/XMLHttpRequest/WebSocket,
// so generated (or pasted) code could otherwise exfiltrate data over the
// network. Shadowing those globals before running user code is hardening
// against a buggy/misbehaving transform, not a real security boundary — a
// worker's own JS engine can't be walled off from itself.
// Exported so a test can run this exact source against a fake `self` without
// needing a real Worker thread (jsdom/happy-dom don't implement one).
export const WORKER_SOURCE = `
self.fetch = undefined;
self.XMLHttpRequest = undefined;
self.WebSocket = undefined;
self.EventSource = undefined;
self.importScripts = undefined;
self.onmessage = (e) => {
  const { code, sheets } = e.data;
  try {
    const fn = new Function("sheets", code);
    const result = fn(sheets);
    if (!Array.isArray(result)) {
      throw new Error("The transform did not return a table (expected an array of rows).");
    }
    const rows = result.map((r) => (r && typeof r === "object" ? r : { value: r }));
    self.postMessage({ ok: true, rows });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
`;

export function runTransform(code, sheetsByName, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const timer = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error("The extraction took too long and was stopped (30s limit)."));
    }, timeoutMs);

    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      if (e.data.ok) resolve(e.data.rows);
      else reject(new Error("The extraction step failed: " + e.data.error));
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error("The extraction step failed: " + (e.message || "unknown error")));
    };

    worker.postMessage({ code, sheets: sheetsByName });
  });
}
