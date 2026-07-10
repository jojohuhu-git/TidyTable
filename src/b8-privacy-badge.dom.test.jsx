// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// B8: the header's privacy claim ("has not left this computer") must become
// false as soon as a request actually goes to Claude. Mock the API/worker so
// we can drive a full offline-decline -> AI request without a real network
// call, and check the badge text updates.
vi.mock("./logic/claude.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requestPlan: vi.fn().mockResolvedValue({ transform_code: "return [];", excel_steps: [], summary: "" }),
  };
});
vi.mock("./logic/runTransform.js", () => ({
  runTransform: vi.fn().mockResolvedValue([]),
}));

import App from "./App.jsx";

describe("B8 — the privacy badge reacts to an actual AI request", () => {
  beforeEach(() => {
    localStorage.setItem("tidytable_api_key", "sk-ant-test-key");
  });

  it("shows the default claim before anything is sent, and updates after a sample-mode send", async () => {
    render(<App />);
    expect(screen.getByText(/has not left this computer/i)).toBeTruthy();

    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());
    expect(screen.getByText(/has not left this computer/i)).toBeTruthy();

    const promptBox = document.querySelector(".prompt-box");
    fireEvent.change(promptBox, { target: { value: "what is the meaning of life" } });
    fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));

    await waitFor(() => expect(screen.getByText(/sent to claude 1 time this session/i)).toBeTruthy());
    expect(screen.getByText(/made-up samples/i)).toBeTruthy();
    expect(screen.queryByText(/has not left this computer/i)).toBeNull();
  });

  it("confirms before switching to full mode, and does not switch if the user cancels", async () => {
    window.confirm = window.confirm || (() => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    const fullRadio = screen.getByRole("radio", { name: /the whole spreadsheet/i });
    fireEvent.click(fullRadio);
    expect(confirmSpy).toHaveBeenCalled();
    expect(fullRadio.checked).toBe(false);
    confirmSpy.mockRestore();
  });

  it("switches to full mode when the user confirms", async () => {
    window.confirm = window.confirm || (() => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    const fullRadio = screen.getByRole("radio", { name: /the whole spreadsheet/i });
    fireEvent.click(fullRadio);
    expect(fullRadio.checked).toBe(true);
    confirmSpy.mockRestore();
  });
});
