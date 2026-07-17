import { useMemo, useState } from "react";
import { columnPickerOptions } from "../logic/columnPickerOptions.js";
import { checkupSheet } from "../logic/checkup/scan.js";

// P1-4b: the no-typing counterpart to P1-4a's typed "most common value
// across X and Y". Tick 2+ columns and press a button instead of phrasing a
// sentence — it builds the exact same English request the matcher already
// understands, so it rides the identical pooled-rank pipeline (clarify,
// remembered policy, outputs) with no new engine or matcher code.
//
// rankFrequencyPooled (cohort.js) treats each pooled column's cell as one
// atomic value — it never splits packed cells. So a column Step 2 flags as
// "several values packed into one cell" (multiValue) would silently
// undercount if pooled here; block the run and say why instead of guessing.
export default function PooledRankPicker({ sheet, busy, onRun }) {
  const options = useMemo(() => columnPickerOptions(sheet, "grouping"), [sheet]);
  const packedColumns = useMemo(
    () => new Set(checkupSheet(sheet).filter((f) => f.type === "multiValue").map((f) => f.column)),
    [sheet],
  );
  const [picked, setPicked] = useState([]);

  function toggle(name) {
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  }

  const pickedPacked = picked.filter((name) => packedColumns.has(name));
  const ready = picked.length >= 2 && pickedPacked.length === 0;

  function run() {
    if (!ready) return;
    onRun(picked);
  }

  if (options.length < 2) return null;

  return (
    <div className="pooled-rank-picker">
      <p className="wizard-label">Or combine columns and rank them together ({picked.length} chosen)</p>
      <div className="col-privacy">
        {options.map((o) => (
          <label key={o.name} className={`col-chip ${picked.includes(o.name) ? "" : "col-chip-off"}`}>
            <input
              type="checkbox"
              checked={picked.includes(o.name)}
              onChange={() => toggle(o.name)}
              disabled={busy}
            />
            {o.name} <span className="dim">({o.badge})</span>
          </label>
        ))}
      </div>
      {pickedPacked.length > 0 && (
        <p className="warn">
          {`"${pickedPacked.join('", "')}" ${pickedPacked.length === 1 ? "has" : "have"} several values packed `}
          {`into one cell — split ${pickedPacked.length === 1 ? "it" : "them"} in Step 2 first, or the count `}
          will treat each packed cell as one value instead of several.
        </p>
      )}
      <div className="run-row">
        <button type="button" className="btn btn-ghost" onClick={run} disabled={!ready || busy}>
          Rank combined columns
        </button>
        <span className="dim">Pick 2 or more columns to count their values as one combined ranking.</span>
      </div>
    </div>
  );
}
