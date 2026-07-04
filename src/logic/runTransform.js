// Runs AI-generated transform code in a Web Worker (no DOM/network access there),
// with a timeout, on the FULL local dataset. The data never leaves the browser here.

const WORKER_SOURCE = `
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
