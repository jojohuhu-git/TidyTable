// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App.jsx";

// Parked item 4, UI layer: a "by A and B" question must show the honest
// decline notice WITH clickable one-column alternatives, and clicking one
// must actually run it and produce an answer card.

function ask(question) {
  const promptBox = document.querySelector(".prompt-box");
  fireEvent.change(promptBox, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
}

describe("parked item 4 — two-column decline renders runnable chips", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the decline and both one-column alternatives, and a chip click answers", async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    ask("how many rows by diagnosis and drug");
    // The message can legitimately appear twice: the notice box AND the P4-6
    // "questions I couldn't answer" list record the same honest reason.
    await waitFor(() => expect(screen.getAllByText(/two columns at once/i).length).toBeGreaterThan(0));
    const wardChip = screen.getByRole("button", { name: "how many rows by Diagnosis" });
    expect(screen.getByRole("button", { name: "how many rows by Drug" })).toBeTruthy();

    fireEvent.click(wardChip);
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    // The notice (and its chips) are gone; only the miss-log line may remain.
    expect(document.querySelector(".notice-alternatives")).toBeNull();
  });
});
