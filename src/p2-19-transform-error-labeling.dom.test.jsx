// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// P2-19: runViaClaude used to funnel BOTH the Claude API call and the local
// worker transform through the same catch -> friendlyApiError, so a bug in
// the generated transform code (nothing to do with the AI call, which
// succeeded) was shown as a generic "Something went wrong talking to the AI"
// message. Mock a successful requestPlan whose transform_code throws, and
// mock runTransform to reject the way the real worker does, to prove the
// error shown names the extraction step instead of blaming the AI call.
vi.mock("./logic/claude.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requestPlan: vi.fn().mockResolvedValue({ transform_code: "return [];", excel_steps: [], summary: "" }),
  };
});
// A transform error that happens to carry a `status` field (e.g. a fetch
// call inside generated code failing with a Response-shaped error) is the
// sharpest way to tell the two code paths apart: run it through
// friendlyApiError and it's misread as "rate limited"; show it as-is and the
// real message survives.
vi.mock("./logic/runTransform.js", () => ({
  runTransform: vi.fn().mockRejectedValue(Object.assign(new Error("The extraction step failed: boom"), { status: 429 })),
}));

import App from "./App.jsx";

describe("P2-19 — a transform-execution failure is shown as-is, not as an AI-call problem", () => {
  beforeEach(() => {
    localStorage.setItem("tidytable_api_key", "sk-ant-test-key");
  });

  it("shows the extraction failure message, not friendlyApiError's status-based reinterpretation", async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    const promptBox = document.querySelector(".prompt-box");
    fireEvent.change(promptBox, { target: { value: "what is the meaning of life" } });
    fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));

    await waitFor(() => expect(screen.getByText(/extraction step failed/i)).toBeTruthy());
    // friendlyApiError would have turned status:429 into a rate-limit message instead.
    expect(screen.queryByText(/rate limit/i)).toBeNull();
  });
});
