import { describe, it, expect } from "vitest";
import { buildReportCards } from "./reportCards.js";

// P2-18: a person whose rows span more than one group used to keep their
// first-seen group but sum values from every group they appeared in —
// wrongly inflating the total shown under that first group and dropping
// their contribution to the other group entirely.
describe("P2-18 — buildReportCards splits a person's total per group", () => {
  it("gives a person who appears under two groups a separate total in each, not one inflated total under the first", () => {
    const rows = [
      { Person: "A1", Group: "North", Amount: 10 },
      { Person: "A1", Group: "South", Amount: 5 },
      { Person: "B1", Group: "North", Amount: 1 },
      { Person: "B2", Group: "South", Amount: 1 },
    ];
    const rc = buildReportCards(rows, { personColumn: "Person", valueColumn: "Amount", groupColumn: "Group" });

    const northCard = rc.cards.find((c) => c.subject === "A1" && c.group === "North");
    const southCard = rc.cards.find((c) => c.subject === "A1" && c.group === "South");

    expect(northCard.value).toBe(10);
    expect(southCard.value).toBe(5);
    // Neither card's total pulls in the other group's amount.
    expect(northCard.value).not.toBe(15);
    expect(southCard.value).not.toBe(15);
  });

  it("each group's bars only include peers from that same group", () => {
    const rows = [
      { Person: "A1", Group: "North", Amount: 10 },
      { Person: "A1", Group: "South", Amount: 5 },
      { Person: "B1", Group: "North", Amount: 1 },
    ];
    const rc = buildReportCards(rows, { personColumn: "Person", valueColumn: "Amount", groupColumn: "Group" });
    const northCard = rc.cards.find((c) => c.subject === "A1" && c.group === "North");
    expect(northCard.bars.map((b) => b.label).sort()).toEqual(["A1", "B1"]);
  });
});
