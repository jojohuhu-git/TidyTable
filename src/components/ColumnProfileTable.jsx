import { useState } from "react";
import { buildColumnProfile } from "../logic/columnProfile.js";

// B6: "which column is my outcome, which is broken" at a glance, before the
// user picks columns anywhere else in the app.
export default function ColumnProfileTable({ sheet }) {
  const [open, setOpen] = useState(true);
  const profile = buildColumnProfile(sheet);

  return (
    <details className="profile-table-wrap" open={open} onToggle={(e) => setOpen(e.target.open)}>
      <summary>What's in my data — {sheet.headers.length} columns</summary>
      <div className="table-scroll">
        <table className="data-table profile-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>% filled</th>
              <th>Distinct</th>
              <th>Values</th>
            </tr>
          </thead>
          <tbody>
            {profile.map((p) => (
              <tr key={p.name} className={p.isEmpty ? "profile-row-empty" : p.isConstant ? "profile-row-constant" : ""}>
                <td><span className="col-letter">{p.letter}</span> {p.name}</td>
                <td>{p.type}</td>
                <td>{p.filledPct}%</td>
                <td>{p.distinctCount}</td>
                <td>
                  {p.summary}
                  {p.isEmpty && <span className="dim"> — nothing to analyze here</span>}
                  {p.isConstant && <span className="dim"> — same value every row</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {profile[0]?.totalRows > profile[0]?.sampledRows && (
        <p className="hint">Based on the first {profile[0].sampledRows.toLocaleString()} of {profile[0].totalRows.toLocaleString()} rows.</p>
      )}
    </details>
  );
}
