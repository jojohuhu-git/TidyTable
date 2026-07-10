// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../src/App.jsx";

beforeEach(() => localStorage.clear());

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

describe("App shell — Phase 0 UX", () => {
  it("shows the permanent local-data reassurance badge", () => {
    render(<App />);
    expect(screen.getByText(/your data has not left this computer/i)).toBeInTheDocument();
  });

  it("labels the first step in words, not a numbered badge", () => {
    render(<App />);
    expect(screen.getByText("Step 1")).toBeInTheDocument();
  });

  it("renders no emoji anywhere in the shell", () => {
    render(<App />);
    expect(document.body.textContent).not.toMatch(EMOJI);
  });

  it("does not order the user to add a key before doing anything", () => {
    render(<App />);
    // With no workbook loaded, the app is still fully usable up to upload.
    expect(screen.queryByText(/add your anthropic api key first/i)).toBeNull();
  });
});
