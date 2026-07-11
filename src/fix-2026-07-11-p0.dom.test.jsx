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

// Fix spec .claude/prompts/fix-2026-07-11-steps-2-3-9-plain-english.md — P0-2/3/4.
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

describe("P0-2 — teach form only when teaching can help", () => {
  it("R3: an unsupported OPERATION (sort) does not offer the teach form", async () => {
    await tryExample();
    ask("sort the rows by visit date newest first");
    await waitFor(() => expect(document.querySelector(".notice-box")).toBeTruthy());
    // No teach-it form for an operation teaching can never fix.
    expect(document.querySelector(".teach-it-form")).toBeNull();
    // The message names what the offline engine can/can't do, in plain English.
    expect(document.body.textContent).toMatch(/can't sort|cannot sort|can't .*pull out rows|Steps 7/i);
  });

  it("still offers the form for a word-resolution failure (average of an unknown word)", async () => {
    await tryExample();
    ask("average widget");
    await waitFor(() => expect(document.querySelector(".teach-it-form")).toBeTruthy());
  });
});

describe("P0-3 — a post-teach re-run that still can't answer does not loop the form", () => {
  it("teaching a text column for a sum shows an honest stop, not the form again", async () => {
    await tryExample();
    ask("total widget");
    await waitFor(() => expect(document.querySelector(".teach-it-form")).toBeTruthy());
    // Teach "widget" -> Diagnosis (a TEXT column) — a sum still can't run.
    fireEvent.change(document.querySelector("#teach-phrase"), { target: { value: "widget" } });
    fireEvent.change(document.querySelector("#teach-column"), { target: { value: "Diagnosis" } });
    fireEvent.click(screen.getByRole("button", { name: /Remember this and ask again/i }));
    // The form must NOT reappear; an honest message explains the save worked but
    // the request still can't be answered offline.
    await waitFor(() => expect(document.body.textContent).toMatch(/words, not numbers/i));
    expect(document.querySelector(".teach-it-form")).toBeNull();
    // The alias WAS saved (the "remember" genuinely worked).
    expect(localStorage.getItem("tidytable_column_aliases")).toContain("Diagnosis");
  });
});

describe("P0-4 — every remember is visibly confirmed", () => {
  it("teaching a column shows a 'Learned:' confirmation line", async () => {
    await tryExample();
    ask("average widget");
    await waitFor(() => expect(document.querySelector(".teach-it-form")).toBeTruthy());
    fireEvent.change(document.querySelector("#teach-phrase"), { target: { value: "widget" } });
    fireEvent.change(document.querySelector("#teach-column"), { target: { value: "Duration_days" } });
    fireEvent.click(screen.getByRole("button", { name: /Remember this and ask again/i }));
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    // The confirmation line names what was learned and that it is saved.
    expect(document.body.textContent).toMatch(/Learned:.*widget.*Duration_days.*saved/i);
  });
});
