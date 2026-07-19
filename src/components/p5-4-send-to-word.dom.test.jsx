// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ResultsPanel from "./ResultsPanel.jsx";

// P5-4: "Send to Word" on a result card — downloads a real .docx with one
// journal-style table (the same row-level data as the on-screen table).

afterEach(() => {
  vi.restoreAllMocks();
});

describe("P5-4 — Send to Word on a result card", () => {
  const plan = { engine: "offline", summary: "Counted rows per Diagnosis.", looked_for: "Rows per Diagnosis" };
  const rows = [
    { Diagnosis: "UTI", Count: 2 },
    { Diagnosis: "pneumonia", Count: 1 },
  ];

  it("triggers a real docx download via an anchor click", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ResultsPanel plan={plan} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /send to word/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toContain("wordprocessingml");
    await waitFor(() => expect(screen.getByText(/downloaded/i)).toBeTruthy());

    vi.unstubAllGlobals();
  });

  it("is disabled when there are no rows to export", () => {
    render(<ResultsPanel plan={plan} rows={[]} />);
    const btn = screen.getByRole("button", { name: /send to word/i });
    expect(btn.disabled).toBe(true);
  });
});
