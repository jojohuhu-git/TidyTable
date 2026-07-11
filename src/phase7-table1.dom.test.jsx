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

// Phase 7.5 (plan-2026-07-10-offline-smarts.md), user-visible layer: a Table-1
// request answers with a publication-style descriptive table.

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

describe("Phase 7.5 (DOM) — Table-1 builder", () => {
  it("'summarize diagnosis, drug and duration' shows a descriptive table", async () => {
    await tryExample();
    ask("summarize diagnosis, drug and duration");
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    // The trust line names the Table-1 intent.
    expect(screen.getAllByText(/Building a Table 1/i).length).toBeGreaterThan(0);
    // Numeric column shown as median (IQR); category level as n (%).
    expect(screen.getAllByText(/median 6 days \(IQR 5–7\.75\)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 \(33\.3%\)/).length).toBeGreaterThan(0);
  });
});
