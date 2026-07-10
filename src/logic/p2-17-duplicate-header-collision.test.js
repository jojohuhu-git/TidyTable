import { describe, it, expect } from "vitest";
import { parseWorkbookFile } from "./workbook.js";

function csvFile(text, name = "test.csv") {
  return new File([text], name, { type: "text/csv" });
}

// P2-17: renaming a repeated "Name" header to "Name (2)" used to collide
// silently with a real column already named "Name (2)" — one column's data
// would overwrite the other's. The renamer must keep incrementing until it
// finds a name nothing else is already using.
describe("P2-17 — duplicate-header rename never collides with an existing column", () => {
  it("skips past an already-taken '(2)' suffix to '(3)'", async () => {
    const csv = "Name,Name (2),Name\n1,2,3\n";
    const result = await parseWorkbookFile(csvFile(csv));
    const names = result.sheets[0].headers.map((h) => h.name);
    expect(names).toEqual(["Name", "Name (2)", "Name (3)"]);
    // Every column keeps its own data — none were overwritten.
    expect(result.sheets[0].rows[0]).toEqual({ "Name": 1, "Name (2)": 2, "Name (3)": 3 });
  });

  it("still uniquifies plain repeats with no pre-existing collision", async () => {
    const csv = "A,A,A\n1,2,3\n";
    const result = await parseWorkbookFile(csvFile(csv));
    const names = result.sheets[0].headers.map((h) => h.name);
    expect(names).toEqual(["A", "A (2)", "A (3)"]);
  });
});
