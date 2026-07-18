// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { serializeChartSvg, copyChartPng } from "./exportChart.js";

// P5-1: chart exports with zero dependencies — a standalone SVG download and
// copy-to-clipboard PNG. The serializer must produce a file that survives
// OUTSIDE the app: the live SVG leans on page CSS (var(--accent) fills,
// class-styled text), which dies in Illustrator/PowerPoint, so computed
// styles are inlined at export time. Honesty rule: the copy helper reports
// failure plainly when the browser can't do it — never a silent no-op.

function makeSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 480 300");
  svg.setAttribute("width", "480");
  svg.setAttribute("height", "300");
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("fill", "#E69F00");
  rect.setAttribute("width", "100");
  rect.setAttribute("height", "10");
  svg.appendChild(rect);
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("class", "chart-label");
  text.textContent = "UTI";
  svg.appendChild(text);
  document.body.appendChild(svg);
  return svg;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("P5-1 — serializeChartSvg", () => {
  it("produces a standalone SVG document: xmlns declared, content preserved", () => {
    const out = serializeChartSvg(makeSvg());
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('viewBox="0 0 480 300"');
    expect(out).toContain("UTI");
  });

  it("keeps literal palette fills exactly as drawn", () => {
    const out = serializeChartSvg(makeSvg());
    expect(out).toContain("#E69F00");
  });

  it("inlines a computed fill over a CSS-variable reference when the browser provides one", () => {
    const svg = makeSvg();
    const varRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    varRect.setAttribute("fill", "var(--accent)");
    svg.appendChild(varRect);
    const realGetComputed = window.getComputedStyle;
    vi.stubGlobal("getComputedStyle", (el) => {
      if (el === varRect) return { getPropertyValue: (p) => (p === "fill" ? "rgb(14, 107, 99)" : "") };
      return realGetComputed(el);
    });
    const out = serializeChartSvg(svg);
    expect(out).toContain("rgb(14, 107, 99)");
    expect(out).not.toContain("var(--accent)");
  });
});

describe("P5-1 — copyChartPng is honest about failure", () => {
  it("reports failure plainly when the browser has no image clipboard", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const res = await copyChartPng(makeSvg());
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/download/i); // points at the working alternative
  });

  it("reports failure when the clipboard write itself throws", async () => {
    vi.stubGlobal("ClipboardItem", class { constructor(items) { this.items = items; } });
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn().mockRejectedValue(new Error("denied")) } });
    const res = await copyChartPng(makeSvg());
    expect(res.ok).toBe(false);
  });

  it("resolves ok with a paste hint when the clipboard accepts the PNG", async () => {
    vi.stubGlobal("ClipboardItem", class { constructor(items) { this.items = items; } });
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const res = await copyChartPng(makeSvg());
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/paste/i);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
