// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Phase 6 (plan-2026-07-10-offline-smarts.md) — AI graduation, wired end-to-end.
//
// When Claude answers a Step-3 request the offline engine declined, the app must
// remember the value-free plan SHAPE keyed by the wording (per file shape) so the
// SAME question is answered OFFLINE next time — no second API call. This is the
// App.jsx wiring around the tested graduationStore logic; the store's own logic
// lives in src/logic/offline/phase6-graduation.test.js.
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

describe("Phase 6 — AI graduation wired into the app", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tidytable_api_key", "sk-ant-test-key");
    requestPlanMock.mockReset();
    runTransformMock.mockReset();
  });

  it("answers the SAME question offline the second time, after Claude answered it once", async () => {
    // A filter-free numeric aggregation the offline matcher declines on this
    // wording ("treatment window" isn't a known everyday word for Duration_days),
    // but whose AI plan text names the numeric column verbatim.
    requestPlanMock.mockResolvedValue({
      summary: "Average of Duration_days across all rows.",
      transform_code: "var n = rows.map(function(r){ return r['Duration_days']; }); return n;",
      excel_steps: [{ title: "Average", instruction: "=AVERAGE over Duration_days" }],
    });
    runTransformMock.mockResolvedValue([{ result: 7 }]);

    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    // First time: offline declines, Claude answers (one API call).
    ask("average treatment window");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(requestPlanMock).toHaveBeenCalledTimes(1);

    // Second time, identical wording: the remembered shape answers OFFLINE — the
    // API is NOT called again.
    ask("average treatment window");
    await waitFor(() =>
      expect(screen.getAllByText(/Result of: your question/i).length).toBeGreaterThanOrEqual(2),
    );
    expect(requestPlanMock).toHaveBeenCalledTimes(1);
  });
});
