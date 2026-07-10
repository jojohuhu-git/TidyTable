import { describe, it, expect } from "vitest";
import { MODELS, buildRequestParams } from "./claude.js";

// P0-3: adaptive thinking is only supported on Claude 4.6+ models. Sending it
// to Haiku 4.5 gets a 400 that broke every request when Haiku was selected.
describe("P0-3 — buildRequestParams omits unsupported params per model", () => {
  it("includes thinking:adaptive for Opus and Sonnet", () => {
    const opus = buildRequestParams("claude-opus-4-8", { system: "s", userMessage: "u" });
    expect(opus.thinking).toEqual({ type: "adaptive" });
    const sonnet = buildRequestParams("claude-sonnet-5", { system: "s", userMessage: "u" });
    expect(sonnet.thinking).toEqual({ type: "adaptive" });
  });

  it("omits the thinking param entirely for Haiku 4.5 (no budget_tokens fallback either)", () => {
    const haiku = buildRequestParams("claude-haiku-4-5", { system: "s", userMessage: "u" });
    expect(haiku.thinking).toBeUndefined();
    expect(haiku).not.toHaveProperty("budget_tokens");
  });

  it("keeps max_tokens at Haiku's cap for every model", () => {
    for (const m of MODELS) {
      const params = buildRequestParams(m.id, { system: "s", userMessage: "u" });
      expect(params.max_tokens).toBe(64000);
    }
  });

  it("every MODELS entry produces a request Anthropic will accept (no thinking param for unsupported models)", () => {
    for (const m of MODELS) {
      const params = buildRequestParams(m.id, { system: "s", userMessage: "u" });
      if (m.supportsAdaptiveThinking) {
        expect(params.thinking).toEqual({ type: "adaptive" });
      } else {
        expect(params.thinking).toBeUndefined();
      }
    }
  });
});
