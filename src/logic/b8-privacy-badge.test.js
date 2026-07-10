import { describe, it, expect } from "vitest";
import { privacyBadgeText } from "./privacyBadge.js";

describe("B8 — privacyBadgeText", () => {
  it("claims nothing has left the computer when no request has been sent", () => {
    expect(privacyBadgeText([])).toBe("Your data has not left this computer.");
  });

  it("reports a sample-mode send count", () => {
    expect(privacyBadgeText([{ mode: "sample" }])).toBe(
      "Sent to Claude 1 time this session (column names + made-up samples).",
    );
    expect(privacyBadgeText([{ mode: "sample" }, { mode: "sample" }])).toBe(
      "Sent to Claude 2 times this session (column names + made-up samples).",
    );
  });

  it("reports full mode once any send used it, even if mixed with sample-mode sends", () => {
    const text = privacyBadgeText([{ mode: "sample" }, { mode: "full" }]);
    expect(text).toMatch(/full mode/);
    expect(text).toMatch(/2 times/);
  });
});
