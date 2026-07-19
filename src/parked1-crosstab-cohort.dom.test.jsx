// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App.jsx";

// Parked item 1, UI layer: a leading "of <cohort> patients," crosstab request
// actually scopes the chart (a), a partial two-column parse offers clickable
// alternatives (b), and the crosstab example chips apply an already-resolved
// plan on click (c).

function encountersFile() {
  const wb = XLSX.utils.book_new();
  const rows = [
    ["Diagnosis", "Drug", "Ward"],
    ["UTI", "nitrofurantoin", "ICU"],
    ["UTI", "nitrofurantoin", "General"],
    ["UTI", "nitrofurantoin", "ICU"],
    ["pneumonia", "azithromycin", "General"],
    ["cystitis", "cephalexin", "ICU"],
    ["cystitis", "cephalexin", "General"],
    ["cystitis", "nitrofurantoin", "ICU"],
    ["cystitis", "cephalexin", "General"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Encounters");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "encounters.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function uploadAndOpenChartStep() {
  render(<App />);
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [encountersFile()] } });
  await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());
  fireEvent.click(screen.getByText(/Analyze & chart/i));
  await waitFor(() => expect(screen.getByPlaceholderText(/organisms in urine/i)).toBeTruthy());
}

function runChartText(value) {
  const box = screen.getByPlaceholderText(/organisms in urine/i);
  fireEvent.change(box, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /make this chart/i }));
}

describe("Parked item 1(a) — leading cohort clause scopes a crosstab request in the real app", () => {
  it("'of cystitis patients, drug mix by ward' draws the filtered crosstab", async () => {
    await uploadAndOpenChartStep();
    runChartText("of cystitis patients, drug mix by ward");
    await waitFor(() => expect(screen.getAllByText(/cystitis.*n=4/i).length).toBeGreaterThan(0));
  });
});

describe("Parked item 1(b) — a partial two-column parse offers clickable alternatives", () => {
  it("shows the honest decline and a clickable alternative that draws a chart when clicked", async () => {
    await uploadAndOpenChartStep();
    runChartText("drug mix by nonsensecolumn");
    await waitFor(() => expect(screen.getByText(/couldn't match "nonsensecolumn"/i)).toBeTruthy());
    const altButtons = screen.getAllByRole("button", { name: /Drug by/i });
    expect(altButtons.length).toBeGreaterThan(0);
    fireEvent.click(altButtons[0]);
    await waitFor(() => expect(screen.queryByText(/couldn't match "nonsensecolumn"/i)).toBeNull());
  });
});

describe("Parked item 1(c) — crosstab example chips apply an already-resolved plan", () => {
  it("clicking a crosstab chip fills in the labels/split-by pickers without needing a re-parse", async () => {
    await uploadAndOpenChartStep();
    const chips = screen.getAllByRole("button", { name: /^(Drug|Ward|Diagnosis) by (Drug|Ward|Diagnosis)$/ });
    fireEvent.click(chips[0]);
    await waitFor(() => {
      const splitBy = screen.getByLabelText(/Split by/i);
      expect(splitBy.value).not.toBe("");
    });
  });
});
