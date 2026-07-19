// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { deriveSheet } from "../logic/workbook.js";

// P5-4: "Send to PowerPoint" on a chart. svgToPngBlob's raster pipeline
// relies on an <img> onload event that happy-dom never fires (same reason
// the P5-1 clipboard-copy test never exercises it either) — mock just that
// one function so the test drives the real pptx-building/download wiring
// around it, the part this feature actually adds.
vi.mock("../logic/charts/exportChart.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    svgToPngBlob: vi.fn().mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
  };
});

import ChartsPanel from "./ChartsPanel.jsx";

function sheet() {
  return deriveSheet("D", [{ Dx: "UTI" }, { Dx: "UTI" }, { Dx: "pneumonia" }]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("P5-4 — Send to PowerPoint on a chart", () => {
  it("downloads a real pptx once a chart is up", async () => {
    // Spy on the real URL's static methods rather than replacing the global
    // — pptxgenjs's dynamic import needs a real `new URL(...)` constructor
    // to resolve, which a stubbed plain-object global would break.
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ChartsPanel sheet={sheet()} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Dx" } });
    fireEvent.click(screen.getByRole("button", { name: /send to powerpoint/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/zip"); // pptxgenjs's own outputType:"blob" mime
    await waitFor(() => expect(screen.getByText(/downloaded/i)).toBeTruthy());
  });
});
