export default function DataTable({ rows, columns, maskedColumns = new Set(), maxRows = 100 }) {
  if (!rows || rows.length === 0) {
    return <p className="hint">No rows to show.</p>;
  }
  const cols = columns && columns.length ? columns : Object.keys(rows[0]);
  const shown = rows.slice(0, maxRows);
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}{maskedColumns.has(c) ? " 🔒" : ""}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>
                  {maskedColumns.has(c)
                    ? "•••"
                    : r[c] == null
                      ? ""
                      : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <p className="hint">Showing the first {maxRows} of {rows.length.toLocaleString()} rows.</p>
      )}
    </div>
  );
}
