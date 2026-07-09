// Report cards (build prompt §7/§11). One card per person: that person compared
// against their peers on a single measure. The subject's own bar is drawn in the
// accent color, every peer bar is gray (this peer-comparison idiom is also the
// default chart style in §11).
//
// PRIVACY INVARIANT: this generator is given only the already-coded table. It is
// never given the deidentification key, so its output cannot contain a real name
// — the people here are whatever labels the person column holds (codes, after the
// deidentify step). Do not add a key/name argument to this function.
//
// Small-cell warning: any displayed group of 1 or 2 people is flagged as
// re-identifiable even without names, with advice to pool or suppress.

function num(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}

// rows: the coded table. options:
//   personColumn — the column holding each person's label (a code after deidentify)
//   valueColumn  — optional numeric column to total per person; if absent, we
//                  count each person's rows instead
//   groupColumn  — optional column to split people into displayed groups (e.g. a
//                  clinic); the small-cell check runs per group
export function buildReportCards(rows, { personColumn, valueColumn = null, groupColumn = null }) {
  const metricLabel = valueColumn ? `total ${valueColumn}` : "number of rows";

  // Aggregate the measure per (person, group) pair — P2-18: a person whose
  // rows span more than one group gets one total per group they actually
  // appear in, instead of every row's value being folded into whichever
  // group their first row happened to belong to.
  const perPersonGroup = new Map(); // "person|||group" -> { person, group, value }
  for (const r of rows) {
    const person = r[personColumn];
    if (person == null || String(person).trim() === "") continue;
    const g = groupColumn ? (r[groupColumn] == null ? "(no group)" : String(r[groupColumn])) : "(all)";
    const key = `${person}|||${g}`;
    const cur = perPersonGroup.get(key) || { person: String(person), group: g, value: 0 };
    if (valueColumn) {
      const n = num(r[valueColumn]);
      if (n != null) cur.value += n;
    } else {
      cur.value += 1;
    }
    perPersonGroup.set(key, cur);
  }

  // Group people for display and small-cell checks.
  const groups = new Map(); // groupLabel -> [{ person, value }]
  for (const { person, group: g, value } of perPersonGroup.values()) {
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ person, value });
  }

  const warnings = [];
  const cards = [];
  for (const [groupLabel, members] of groups.entries()) {
    const smallCell = members.length <= 2;
    if (smallCell) {
      warnings.push({
        group: groupColumn ? groupLabel : null,
        size: members.length,
        message: groupColumn
          ? `The group "${groupLabel}" has only ${members.length} ${members.length === 1 ? "person" : "people"}. A group this small can be traced back to a real person even without names — consider pooling it with another group or leaving it out.`
          : `Only ${members.length} ${members.length === 1 ? "person is" : "people are"} shown. A group this small can be traced back to a real person even without names — consider pooling or leaving it out.`,
      });
    }
    // Sort peers by the measure, biggest first, so a card reads at a glance.
    const sorted = [...members].sort((a, b) => b.value - a.value);
    for (const subject of sorted) {
      cards.push({
        subject: subject.person,
        group: groupColumn ? groupLabel : null,
        value: subject.value,
        smallCell,
        bars: sorted.map((m) => ({
          label: m.person,
          value: m.value,
          isSubject: m.person === subject.person,
        })),
      });
    }
  }

  return { metricLabel, personColumn, valueColumn, groupColumn, cards, warnings };
}
