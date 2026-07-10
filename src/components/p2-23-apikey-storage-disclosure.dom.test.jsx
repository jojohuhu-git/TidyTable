// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ApiKeyPanel from "./ApiKeyPanel.jsx";

// P2-23: the API key is stored in plaintext localStorage — acceptable for
// this browser-only architecture, but the "Remember on this computer"
// checkbox didn't say so. Disclose it plainly whenever remembering is on.
describe("P2-23 — ApiKeyPanel discloses that a remembered key is stored unencrypted", () => {
  it("shows the plaintext-storage warning when 'Remember' is checked (the default)", () => {
    render(<ApiKeyPanel apiKey="" setApiKey={() => {}} model="claude-sonnet-5" setModel={() => {}} />);
    expect(screen.getByText(/stored unencrypted/i)).toBeTruthy();
    expect(screen.getByText(/low spending limit/i)).toBeTruthy();
  });

  it("hides the warning once 'Remember' is unchecked", () => {
    render(<ApiKeyPanel apiKey="" setApiKey={() => {}} model="claude-sonnet-5" setModel={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByText(/stored unencrypted/i)).toBeNull();
  });
});
