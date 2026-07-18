import { describe, it, expect } from "vitest";
import { buildTableHtml, buildTableText } from "./tableHtml.js";

// P5-1 (fix-2026-07-11-steps-2-3-9-plain-english.md): "Copy table for Word" —
// result tables (including Table 1) leave the app as REAL table structure
// (text/html), so pasting into Word/PowerPoint keeps rows and columns, not a
// blob of tab-separated text. These are the pure builders; the clipboard
// wiring is exercised in the ResultsPanel DOM test.

const rows = [
  { Diagnosis: "UTI", Count: 5 },
  { Diagnosis: "pneumonia", Count: 3 },
  { Diagnosis: null, Count: 0 },
];

describe("P5-1 — buildTableHtml", () => {
  it("builds a real <table> with a header row and one <tr> per data row", () => {
    const html = buildTableHtml(rows);
    expect(html).toMatch(/^<table/);
    expect(html).toContain("<th>Diagnosis</th>");
    expect(html).toContain("<th>Count</th>");
    expect((html.match(/<tr>/g) || []).length).toBe(4); // 1 header + 3 data
    expect(html).toContain("<td>UTI</td>");
    expect(html).toContain("<td>5</td>");
  });

  it("respects an explicit column order", () => {
    const html = buildTableHtml(rows, ["Count", "Diagnosis"]);
    expect(html.indexOf("<th>Count</th>")).toBeLessThan(html.indexOf("<th>Diagnosis</th>"));
  });

  it("renders a null cell as empty, never the word 'null'", () => {
    const html = buildTableHtml(rows);
    expect(html).toContain("<td></td>");
    expect(html).not.toContain("null");
  });

  it("escapes HTML in cell values so pasted content can't break or lie", () => {
    const html = buildTableHtml([{ Note: 'a<b & "c"' }]);
    expect(html).toContain("a&lt;b &amp; ");
    expect(html).not.toContain("a<b");
  });

  it("returns an empty string for no rows", () => {
    expect(buildTableHtml([])).toBe("");
  });
});

describe("P5-1 — buildTableText (plain-text fallback)", () => {
  it("is tab-separated with a header line, one line per row", () => {
    const text = buildTableText(rows);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Diagnosis\tCount");
    expect(lines[1]).toBe("UTI\t5");
    expect(lines.length).toBe(4);
  });
});
