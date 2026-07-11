// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("./logic/runTransform.js", () => ({
  runTransform: vi.fn(async (code, sheetsByName) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", code);
    return fn(sheetsByName);
  }),
}));

const { default: App } = await import("./App.jsx");

// Phase 7.8 (plan-2026-07-10-offline-smarts.md), user-visible layer: clicking
// "Show the rows behind this number" reveals the exact matched rows.

async function tryExample() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Try it with example data/i }));
  await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
}

function ask(question) {
  const box = document.querySelector(".prompt-box");
  fireEvent.change(box, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
}

beforeEach(() => localStorage.clear());

describe("Phase 7.8 (DOM) — show the rows behind the number", () => {
  it("reveals the matched rows on click", async () => {
    await tryExample();
    ask("how many records with UTI");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());

    const reveal = screen.getByRole("button", { name: /Show the 2 rows behind this number/i });
    expect(reveal).toBeTruthy();
    fireEvent.click(reveal);

    await waitFor(() => expect(document.querySelector(".behind-rows")).toBeTruthy());
    // The two matching patients (P1, P3) appear in the revealed table.
    const behind = document.querySelector(".behind-rows");
    expect(behind.textContent).toMatch(/P1/);
    expect(behind.textContent).toMatch(/P3/);
    // Toggling hides it again.
    fireEvent.click(screen.getByRole("button", { name: /Hide the rows behind this number/i }));
    expect(document.querySelector(".behind-rows")).toBeNull();
  });
});
