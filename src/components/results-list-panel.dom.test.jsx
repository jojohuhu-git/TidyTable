// @vitest-environment happy-dom
import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResultsListPanel from "./ResultsListPanel.jsx";

// W3 (Step 4 — "Your results so far"): the accumulating list of result cards
// that replaces the old single-most-recent-result view. Each card shows a
// one-line answer at a glance, expands to the full existing ResultsPanel, and
// carries a per-card remove button. A card for an offline-answered question
// shows the "Saved to your routine" badge; one answered by AI does not.

function samplePlan(summary) {
  return {
    engine: "offline",
    looked_for: "Counting rows where X is Y.",
    summary,
    excel_steps: [{ title: "Level 1", instruction: "Do the thing.", where: "Sheet1" }],
    r_script: "# nothing to run yet\n",
  };
}

function Harness({ initial }) {
  const [results, setResults] = useState(initial);
  const [expandedId, setExpandedId] = useState(null);
  return (
    <ResultsListPanel
      results={results}
      expandedId={expandedId}
      onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
      onRemove={(id) => setResults((r) => r.filter((e) => e.id !== id))}
    />
  );
}

function twoResults() {
  return [
    {
      id: "b", kind: "question", label: 'Result of: your question "how many ICU"', answer: "2 rows",
      timestamp: 2, plan: samplePlan("second card detail"), resultRows: [{ a: 1 }], savedToRoutine: true,
    },
    {
      id: "a", kind: "checkup", label: "Result of: 1 checkup fix", answer: "4 rows cleaned",
      timestamp: 1, plan: samplePlan("first card detail"), resultRows: [{ a: 1 }], savedToRoutine: true,
    },
  ];
}

describe("ResultsListPanel — Your results so far", () => {
  it("shows an empty state with nothing recorded yet", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/Nothing to show yet/i)).toBeTruthy();
  });

  it("renders newest first and expands a card to the full ResultsPanel", () => {
    render(<Harness initial={twoResults()} />);

    const cards = screen.getAllByRole("button", { name: /Result of:/i });
    expect(cards[0]).toHaveTextContent("how many ICU");
    expect(cards[1]).toHaveTextContent("1 checkup fix");

    // Collapsed by default — no ResultsPanel tabs yet.
    expect(screen.queryByRole("tablist")).toBeNull();

    fireEvent.click(cards[0]);
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByText("second card detail")).toBeTruthy();

    // An offline-answered question card is flagged as saved into the routine.
    expect(screen.getByText(/Saved to your routine/i)).toBeTruthy();
  });

  it("shows an AI-answered card as not saved to the routine", () => {
    const results = [{
      id: "c", kind: "question", label: 'Result of: your question "free-form ask"', answer: "5 rows",
      timestamp: 3, plan: samplePlan("ai detail"), resultRows: [{ a: 1 }], savedToRoutine: false,
    }];
    render(<Harness initial={results} />);
    expect(screen.getByText(/Not saved to your routine \(used AI\)/i)).toBeTruthy();
  });

  it("removing a card takes it out of the list, collapsing its detail with it", () => {
    render(<Harness initial={twoResults()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Result of:/i })[0]);
    expect(screen.getByText("second card detail")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);
    expect(screen.queryByText(/how many ICU/)).toBeNull();
    expect(screen.queryByText("second card detail")).toBeNull();
    // The other card is untouched.
    expect(screen.getByText(/1 checkup fix/)).toBeTruthy();
  });
});
