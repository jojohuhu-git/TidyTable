import vm from "node:vm";
import { describe, it, expect } from "vitest";
import { WORKER_SOURCE } from "./runTransform.js";

// P1-11: a worker has no DOM, but fetch/XMLHttpRequest/WebSocket/EventSource/
// importScripts are still there by default — generated (or pasted) transform
// code could otherwise send the full dataset somewhere. WORKER_SOURCE shadows
// them before running user code.
//
// In a real Worker, `self` IS the global object, so `self.fetch = undefined`
// shadows the bare `fetch` identifier the transform code calls. A plain JS
// object standing in for `self` would not reproduce that — bare identifiers
// in the transform's `new Function(...)` body would still resolve to the
// *real* global fetch/WebSocket. A vm context whose global object doubles as
// `self` reproduces the real aliasing, so this is a real behavioral test.
function runInFakeWorker(code, sheets) {
  let posted = null;
  const sandbox = { postMessage: (msg) => { posted = msg; } };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(WORKER_SOURCE, sandbox);
  sandbox.onmessage({ data: { code, sheets } });
  return posted;
}

describe("P1-11 — worker shadows network escape hatches before running user code", () => {
  it("a transform calling fetch fails clearly instead of succeeding", () => {
    const result = runInFakeWorker("fetch('https://example.com'); return [];", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fetch is not a function|not defined/i);
  });

  it("a transform calling XMLHttpRequest fails clearly", () => {
    const result = runInFakeWorker("new XMLHttpRequest(); return [];", {});
    expect(result.ok).toBe(false);
  });

  it("a transform calling WebSocket fails clearly", () => {
    const result = runInFakeWorker("new WebSocket('wss://example.com'); return [];", {});
    expect(result.ok).toBe(false);
  });

  it("an ordinary transform with no network calls still works", () => {
    const result = runInFakeWorker("return sheets.Sheet1;", { Sheet1: [{ a: 1 }] });
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([{ a: 1 }]);
  });
});
