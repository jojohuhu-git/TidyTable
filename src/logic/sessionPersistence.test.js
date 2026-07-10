// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { saveSession, loadSession, clearSession } from "./sessionPersistence.js";

describe("B5 — session log/recipe survive a refresh via localStorage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a session log and recipe", () => {
    const sessionLog = [{ at: "2026-07-09T00:00:00.000Z", fileName: "m.xlsx", sheet: "Sheet1", entries: [] }];
    const recipe = { version: 1, name: "Monthly cleanup", createdAt: "2026-07-09T00:00:00.000Z", steps: [] };
    saveSession({ sessionLog, recipe });
    expect(loadSession()).toEqual({ sessionLog, recipe });
  });

  it("returns null when nothing has been saved yet", () => {
    expect(loadSession()).toBe(null);
  });

  it("clearSession removes a saved session", () => {
    saveSession({ sessionLog: [], recipe: null });
    clearSession();
    expect(loadSession()).toBe(null);
  });

  it("tolerates corrupted storage instead of throwing", () => {
    localStorage.setItem("tidytable_session_v1", "{not json");
    expect(loadSession()).toBe(null);
  });
});
