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

// Phase 7.9 (plan-2026-07-10-offline-smarts.md), user-visible layer: with no API
// key, a declined question offers a teach-it form; teaching a column re-runs the
// question, now answered offline.

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

describe("Phase 7.9 (DOM) — teach-it form on decline (no API key)", () => {
  it("shows the form on decline, and teaching a column answers the question", async () => {
    await tryExample();
    ask("average widget");
    // Declines → the teach-it form appears (no key set in this test).
    await waitFor(() => expect(document.querySelector(".teach-it-form")).toBeTruthy());

    // Teach: "widget" means the Duration_days column.
    const phrase = document.querySelector("#teach-phrase");
    fireEvent.change(phrase, { target: { value: "widget" } });
    fireEvent.change(document.querySelector("#teach-column"), { target: { value: "Duration_days" } });
    fireEvent.click(screen.getByRole("button", { name: /Remember this and ask again/i }));

    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(screen.getAllByText(/Averaging "Duration_days"/i).length).toBeGreaterThan(0);
    // The alias persisted for this file shape.
    expect(localStorage.getItem("tidytable_column_aliases")).toContain("Duration_days");
  });
});
