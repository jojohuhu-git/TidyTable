// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StatsPanel from "./StatsPanel.jsx";
import { deriveSheet } from "../logic/workbook.js";

// P2-22: the t-test crosscheck used to print every raw value inline — for a
// real-sized group that's unreadable and slow to render. Cap the inline list
// and offer a copy button for the full lists instead.
function bigSheet() {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ Group: "A", Value: i });
  for (let i = 0; i < 60; i++) rows.push({ Group: "B", Value: i + 5 });
  return deriveSheet("D", rows);
}

describe("P2-22 — StatsPanel caps inline raw values in the t-test crosscheck", () => {
  it("shows an '...and N more' truncation instead of all 60 values per group, plus a copy button", () => {
    render(<StatsPanel sheet={bigSheet()} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Group" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Value" } });

    expect(screen.getByText(/…and 10 more/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy full lists/i })).toBeTruthy();
  });

  it("does not truncate or show a copy button for a small group", () => {
    const rows = [
      { Group: "A", Value: 1 }, { Group: "A", Value: 2 }, { Group: "A", Value: 3 },
      { Group: "B", Value: 4 }, { Group: "B", Value: 5 }, { Group: "B", Value: 6 },
    ];
    render(<StatsPanel sheet={deriveSheet("D", rows)} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Group" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Value" } });

    expect(screen.queryByText(/…and/)).toBeNull();
    expect(screen.queryByRole("button", { name: /copy full lists/i })).toBeNull();
  });
});
