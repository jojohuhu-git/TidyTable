// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// B11: a transform_code failure used to be a dead end (one error line, no
// recovery). "Try again" should re-send the same question with the prior
// failure appended, asking for corrected code — and offer exactly one retry.
const requestPlanMock = vi.fn();
vi.mock("./logic/claude.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requestPlan: (...args) => requestPlanMock(...args) };
});

const runTransformMock = vi.fn();
vi.mock("./logic/runTransform.js", () => ({
  runTransform: (...args) => runTransformMock(...args),
}));

import App from "./App.jsx";

function ask(question) {
  const promptBox = document.querySelector(".prompt-box");
  fireEvent.change(promptBox, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
}

describe("B11 — AI failure retry path", () => {
  beforeEach(() => {
    localStorage.setItem("tidytable_api_key", "sk-ant-test-key");
    requestPlanMock.mockReset();
    runTransformMock.mockReset();
  });

  it("offers 'Try again' after a transform failure, and the retry request names the prior failure", async () => {
    requestPlanMock
      .mockResolvedValueOnce({ transform_code: "throw new Error('bad')", excel_steps: [], summary: "" })
      .mockResolvedValueOnce({ transform_code: "return [];", excel_steps: [], summary: "" });
    runTransformMock
      .mockRejectedValueOnce(new Error("The extraction step failed: boom"))
      .mockResolvedValueOnce([]);

    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    ask("what is the meaning of life");
    await waitFor(() => expect(screen.getByText(/extraction step failed/i)).toBeTruthy());

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryBtn);

    await waitFor(() => expect(requestPlanMock).toHaveBeenCalledTimes(2));
    const secondCallArgs = requestPlanMock.mock.calls[1][0];
    expect(secondCallArgs.userRequest).toMatch(/previous transform failed with/i);
    expect(secondCallArgs.userRequest).toMatch(/return corrected code/i);

    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("does not offer a second retry if the retry attempt also fails", async () => {
    requestPlanMock.mockResolvedValue({ transform_code: "return [];", excel_steps: [], summary: "" });
    runTransformMock.mockRejectedValue(new Error("The extraction step failed: still broken"));

    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    ask("what is the meaning of life");
    await waitFor(() => expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(requestPlanMock).toHaveBeenCalledTimes(2));

    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});
