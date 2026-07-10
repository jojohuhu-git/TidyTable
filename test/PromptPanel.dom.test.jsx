// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PromptPanel from "../src/components/PromptPanel.jsx";

function setup(overrides = {}) {
  const props = {
    prompt: "count the rows",
    setPrompt: () => {},
    onRun: vi.fn(),
    busy: false,
    status: "",
    canRun: true,
    needsKey: true,
    dataContext: "some context",
    model: "claude-opus-4-8",
    privacyMode: "sample",
    ...overrides,
  };
  render(<PromptPanel {...props} />);
  return props;
}

describe("PromptPanel — no hard API-key gate", () => {
  it("run button is enabled with a prompt even when no key is set", () => {
    setup({ needsKey: true, canRun: true });
    const btn = screen.getByRole("button", { name: /answer my question/i });
    expect(btn).toBeEnabled();
  });

  it("shows a plain, non-blocking note about the key rather than an order to add one first", () => {
    setup({ needsKey: true });
    expect(screen.queryByText(/add your anthropic api key first/i)).toBeNull();
    expect(screen.getByText(/a key is only needed/i)).toBeInTheDocument();
  });

  it("states plainly that sample mode never sends real cell contents", () => {
    setup({ privacyMode: "sample" });
    expect(screen.getByText(/never your real cell contents/i)).toBeInTheDocument();
  });

  it("warns clearly when full mode would send every value", () => {
    setup({ privacyMode: "full" });
    expect(screen.getByText(/send every value/i)).toBeInTheDocument();
  });
});
