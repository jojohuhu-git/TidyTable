// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResultsListPanel from "../src/components/ResultsListPanel.jsx";

// Phase 8.4 — a chartable Step 3 answer offers a one-click "Chart this" that
// seeds Step 9 with the same request, no re-typing.

function card(extra) {
  return {
    id: "r1", kind: "question", label: 'Result of: your question "patients by ward"',
    answer: "5 in North, 3 in South", timestamp: Date.now(), plan: null, resultRows: null,
    savedToRoutine: true, ...extra,
  };
}

describe("ResultsListPanel — Chart this chip", () => {
  it("shows 'Chart this' and calls onChart with the answer's request when chartable", () => {
    const onChart = vi.fn();
    render(
      <ResultsListPanel
        results={[card({ chartRequest: "patients by ward" })]}
        expandedId={null}
        onToggle={() => {}}
        onRemove={() => {}}
        onChart={onChart}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /chart this/i }));
    expect(onChart).toHaveBeenCalledWith("patients by ward");
  });

  it("hides 'Chart this' for an answer that isn't chartable", () => {
    render(
      <ResultsListPanel
        results={[card({ chartRequest: null })]}
        expandedId={null}
        onToggle={() => {}}
        onRemove={() => {}}
        onChart={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /chart this/i })).toBeNull();
  });
});
