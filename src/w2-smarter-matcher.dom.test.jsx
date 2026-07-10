// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// happy-dom has no real Worker; like the other DOM tests, run the generated
// transform synchronously in-process so a confirmed answer actually completes.
vi.mock("./logic/runTransform.js", () => ({
  runTransform: vi.fn(async (code, sheetsByName) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function("sheets", code);
    return fn(sheetsByName);
  }),
}));

const { default: App } = await import("./App.jsx");

// W2: the owner's real failure — "number of patients with E. Coli in urine"
// finding ESCHERICHIA COLI under a "Urine Organisms" column — now answers
// offline via a one-click "Did you mean…?" confirmation. This DOM test drives
// that whole flow, plus the file-derived example chips (W2f).
function urineXlsxFile() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["PatientID", "Urine Organisms", "Ward"],
    ["P1", "ESCHERICHIA COLI", "ICU"],
    ["P2", "KLEBSIELLA PNEUMONIAE", "General"],
    ["P3", "ESCHERICHIA COLI", "General"],
    ["P4", "PSEUDOMONAS AERUGINOSA", "ICU"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Cultures");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "DC antibiotics.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function upload(file) {
  render(<App />);
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
}

function ask(question) {
  const box = document.querySelector(".prompt-box");
  fireEvent.change(box, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /answer my question/i }));
}

// The "Did you mean…?" candidate button, scoped to the clarify box so it isn't
// confused with an example chip that mentions the same value.
function confirmButton() {
  const box = document.querySelector(".clarify");
  return [...box.querySelectorAll("button")].find((b) => /ESCHERICHIA COLI/i.test(b.textContent));
}

describe("W2 — middle-path confirmation flow (E. coli in urine)", () => {
  it("shows a 'Did you mean…?' confirm for the stretch, then answers on click", async () => {
    await upload(urineXlsxFile());

    ask("number of patients with E. Coli in urine");

    // The stretch (prefix match under a fuzzy column scope) is confirmed, not
    // silently answered and not blocked as a missing definition.
    await waitFor(() => expect(screen.getByText(/Did you mean/i)).toBeTruthy());
    const confirmBtn = confirmButton();
    expect(confirmBtn).toBeTruthy();
    // The confirmation names the real column it landed on, so a wrong scope is
    // visible before the user trusts the number.
    expect(document.querySelector(".clarify").textContent).toMatch(/Urine Organisms/i);

    // One click runs it and produces a real result.
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());
    expect(screen.queryByText(/Did you mean/i)).toBeNull();
  });

  it("does not ask again for the same phrase after it is confirmed once (session alias)", async () => {
    await upload(urineXlsxFile());

    ask("number of patients with E. Coli in urine");
    await waitFor(() => expect(screen.getByText(/Did you mean/i)).toBeTruthy());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByText(/Result of: your question/i)).toBeTruthy());

    // Ask the exact same thing again: it answers immediately, no confirm box.
    ask("number of patients with E. Coli in urine");
    await waitFor(() => expect(screen.getAllByText(/Result of: your question/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Did you mean/i)).toBeNull();
  });
});

describe("W2f — file-derived example prompts", () => {
  it("renders clickable offline example chips built from the uploaded file, and clicking one fills the box", async () => {
    await upload(urineXlsxFile());

    expect(screen.getByText(/Answered on this computer, no key needed:/i)).toBeTruthy();
    // Examples are built from real headers/values (ESCHERICHIA COLI / Ward).
    const chips = [...document.querySelectorAll(".example-chip-offline")];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.some((c) => /ESCHERICHIA COLI|Ward/i.test(c.textContent))).toBe(true);
    fireEvent.click(chips[0]);
    expect(document.querySelector(".prompt-box").value.length).toBeGreaterThan(0);

    // The plain-words cheat-sheet is present.
    expect(screen.getByText(/What kinds of questions work without AI/i)).toBeTruthy();
  });
});
