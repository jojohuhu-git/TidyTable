// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App.jsx";

// P4-5: "Export all results to Word" — a committee report built from every
// result card, shipped as part of P5-4 (same docx dependency/code path).

afterEach(() => {
  vi.restoreAllMocks();
});

describe("P4-5 — Export all results to Word", () => {
  it("is absent before any result exists, appears once a card is answered, and downloads a docx", async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    expect(screen.queryByRole("button", { name: /export all results to word/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /how many rows by diagnosis/i }));
    fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /export all results to word/i })).toBeTruthy());

    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: /export all results to word/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toContain("wordprocessingml");
    await waitFor(() => expect(screen.getByText(/downloaded a report with 1 table/i)).toBeTruthy());

    vi.unstubAllGlobals();
  });

  it("answering two questions builds a two-table report", async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Try it with example data/i));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /how many rows by diagnosis/i }));
    fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /export all results to word/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /how many rows have cephalexin\?/i }));
    fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));

    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await waitFor(() => expect(screen.getAllByText(/Diagnosis|cephalexin/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /export all results to word/i }));

    await waitFor(() => expect(screen.getByText(/downloaded a report with 2 tables/i)).toBeTruthy());
    vi.unstubAllGlobals();
  });
});
