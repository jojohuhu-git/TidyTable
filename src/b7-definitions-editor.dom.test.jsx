// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App.jsx";

// B7: a question blocked on an undefined clinical term shows an inline form
// instead of a dead-end notice; typing the meaning re-runs the same question
// automatically, no Excel round-trip.
function ask(question) {
  const promptBox = document.querySelector(".prompt-box");
  fireEvent.change(promptBox, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
}

describe("B7 — DefinitionsEditor unblocks a needs_definitions question in-app", () => {
  it("shows the inline definitions form, and adding a definition re-runs the question and answers it", async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    ask("how many had oral beta-lactam");
    await waitFor(() => expect(screen.getByLabelText(/^term$/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/column it applies to/i), { target: { value: "Drug" } });
    fireEvent.change(screen.getByLabelText(/values that count/i), {
      target: { value: "cephalexin, amoxicillin, cefpodoxime" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add definition and ask again/i }));

    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(screen.queryByLabelText(/^term$/i)).toBeNull();
  });

  it("'Not now' dismisses the form without answering", async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    ask("how many had oral beta-lactam");
    await waitFor(() => expect(screen.getByLabelText(/^term$/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.queryByLabelText(/^term$/i)).toBeNull();
  });
});
