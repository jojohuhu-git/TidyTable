// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DefinitionsPanel from "./DefinitionsPanel.jsx";
import { emptyDefinitionsStore, addDefinitionEntry } from "../logic/offline/definitionsStore.js";
import { buildDefinitionEntry } from "../logic/offline/definitions.js";

describe("B7 — DefinitionsPanel", () => {
  it("renders nothing when the store is empty", () => {
    const { container } = render(<DefinitionsPanel store={emptyDefinitionsStore()} onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists each definition and removes one on click", () => {
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("oral beta-lactam", "Drug", "cephalexin"));
    const onChange = vi.fn();
    render(<DefinitionsPanel store={store} onChange={onChange} />);
    expect(screen.getByText("oral beta-lactam")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onChange).toHaveBeenCalledWith({ entries: [] });
  });

  it("importing a definitions JSON file merges it in, with the imported entry winning on a term collision", async () => {
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("oral beta-lactam", "Drug", "cephalexin"));
    const onChange = vi.fn();
    render(<DefinitionsPanel store={store} onChange={onChange} />);

    const importText = JSON.stringify({ version: 1, entries: [buildDefinitionEntry("oral beta-lactam", "Drug", "cephalexin, amoxicillin")] });
    const file = new File([importText], "definitions.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const merged = onChange.mock.calls[0][0];
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0].values).toEqual(["cephalexin", "amoxicillin"]);
  });

  it("shows a plain error for a file that isn't a definitions export", async () => {
    let store = emptyDefinitionsStore();
    store = addDefinitionEntry(store, buildDefinitionEntry("x", "Drug", "cephalexin"));
    render(<DefinitionsPanel store={store} onChange={() => {}} />);

    const file = new File(["not json"], "bad.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/does not look like a tidytable definitions export/i)).toBeTruthy());
  });
});
