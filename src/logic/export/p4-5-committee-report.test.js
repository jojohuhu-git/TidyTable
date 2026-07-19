import { describe, it, expect } from "vitest";
import { Document, Packer } from "docx";
import JSZip from "jszip";
import { buildReportChildren } from "./exportDocx.js";

async function renderXml(children) {
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml").async("string");
}

function questionResult(label, rows, summary = `${label} summary`) {
  return { id: label, label, answer: "3", plan: { summary, looked_for: label }, resultRows: rows };
}

function compoundResult(label, parts) {
  return {
    id: label,
    label,
    answer: "combined",
    plan: { parts: parts.map(({ summary, rows }) => ({ plan: { summary }, rows })) },
    resultRows: [],
  };
}

describe("buildReportChildren (P4-5 committee report)", () => {
  it("returns sectionCount 0 and no children when nothing is exportable", async () => {
    const { children, sectionCount } = await buildReportChildren([]);
    expect(sectionCount).toBe(0);
    expect(children).toEqual([]);
  });

  it("skips cards with no plan/resultRows (stale after a refresh) and empty-row cards", async () => {
    const staleCard = { id: "x", label: "Stale", answer: "?", plan: null, resultRows: null };
    const emptyCard = questionResult("Empty", []);
    const { sectionCount } = await buildReportChildren([staleCard, emptyCard]);
    expect(sectionCount).toBe(0);
  });

  it("builds one section per plain result card, oldest first", async () => {
    // results are stored newest-first, as App.jsx does
    const results = [
      questionResult("Second question", [{ Drug: "amoxicillin", Count: 2 }]),
      questionResult("First question", [{ Diagnosis: "UTI", Count: 3 }]),
    ];
    const { children, sectionCount } = await buildReportChildren(results);
    expect(sectionCount).toBe(2);
    const xml = await renderXml(children);
    expect(xml.indexOf("First question")).toBeLessThan(xml.indexOf("Second question"));
  });

  it("puts a page break between sections but not before the first", async () => {
    const results = [questionResult("B", [{ a: 1 }]), questionResult("A", [{ a: 2 }])];
    const { children } = await buildReportChildren(results);
    const xml = await renderXml(children);
    const breakCount = (xml.match(/w:type="page"/g) || []).length;
    expect(breakCount).toBe(1); // 2 sections -> 1 break between them
  });

  it("expands a compound (parts) card into one section per part", async () => {
    const compound = compoundResult("Cystitis breakdown", [
      { summary: "Part a: antibiotics", rows: [{ Drug: "amoxicillin", Count: 2 }] },
      { summary: "Part b: durations", rows: [{ Duration_days: "5", Count: 1 }] },
    ]);
    const { children, sectionCount } = await buildReportChildren([compound]);
    expect(sectionCount).toBe(2);
    const xml = await renderXml(children);
    expect(xml).toContain("Cystitis breakdown — part 1");
    expect(xml).toContain("Cystitis breakdown — part 2");
    expect(xml).toContain("amoxicillin");
  });
});
