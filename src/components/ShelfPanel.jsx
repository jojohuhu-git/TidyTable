import { useMemo, useState } from "react";
import DataTable from "./DataTable.jsx";
import { downloadRowsAsXlsx } from "../logic/workbook.js";
import {
  antiJoin, leftJoinLookup, explodePairedLists, asOfJoin, reshapeLongToWide, reshapeWideToLong,
} from "../logic/offline/shelf.js";
import { buildShelfExamples } from "../logic/offline/examplePrompts.js";
import StepHelpPanel from "./StepHelpPanel.jsx";

// Step 10 (build prompt §8, recipe shelf): the multi-step data moves, each run on
// this computer. Every operation reports what didn't line up (unmatched rows,
// unequal list pairs) rather than guessing or dropping it.
const OPS = [
  { id: "antijoin", name: "Rows here that are missing from another sheet", needsB: true },
  { id: "lookup", name: "Look up a value from another sheet (by a shared column)", needsB: true },
  { id: "asof", name: "Attach each row's most recent earlier record from another sheet", needsB: true },
  { id: "explode", name: "Split paired list cells into one row each", needsB: false },
  { id: "long2wide", name: "One row per visit → one row per patient", needsB: false },
  { id: "wide2long", name: "One row per patient → one row per visit", needsB: false },
];

export default function ShelfPanel({ workbook }) {
  const sheets = workbook.sheets;
  const [op, setOp] = useState("");
  const [bSheet, setBSheet] = useState(sheets[1]?.name || "");
  const [key, setKey] = useState("");
  const [time, setTime] = useState("");
  const [colX, setColX] = useState("");
  const [colY, setColY] = useState("");
  const [bring, setBring] = useState([]);

  const A = sheets[0];
  const B = sheets.find((s) => s.name === bSheet) || null;
  const aCols = A.headers.map((h) => h.name);
  const bCols = B ? B.headers.map((h) => h.name) : [];
  const opDef = OPS.find((o) => o.id === op);
  const examples = useMemo(() => buildShelfExamples(A), [A]);

  const result = useMemo(() => {
    if (!op) return null;
    try {
      if (op === "antijoin" && B && key) return single(antiJoin(A.rows, B.rows, key));
      if (op === "lookup" && B && key && bring.length) return withFlag(leftJoinLookup(A.rows, B.rows, key, bring), "unmatched", "had no match");
      if (op === "asof" && B && key && time && bring.length) return withFlag(asOfJoin(A.rows, B.rows, key, time, bring), "unmatched", "had no earlier record");
      if (op === "explode" && colX && colY) return withFlag(explodePairedLists(A.rows, colX, colY), "mismatched", "had lists of different lengths (left for you to fix)");
      if (op === "long2wide" && key && colX && colY) {
        const r = reshapeLongToWide(A.rows, key, colX, colY);
        return { ...single(r.rows), collisionCount: r.collisions };
      }
      if (op === "wide2long" && key && bring.length) return single(reshapeWideToLong(A.rows, key, bring));
      return null;
    } catch (err) {
      return { error: err.message };
    }
  }, [op, A, B, key, time, colX, colY, bring]);

  function toggleBring(name) {
    setBring((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  }

  return (
    <div className="shelf-panel">
      <StepHelpPanel
        whatItDoes="Multi-step moves that need more than a single count: find rows missing from another sheet, look up or attach a value from a second sheet, split paired list cells, or switch between one row per visit and one row per patient."
        cantDoYet={[
          sheets.length < 2
            ? "Most of these need a second sheet in your file — only the reshape below works with one sheet."
            : "Nothing is guessed — any row or list pair that doesn't line up is shown, not dropped.",
        ]}
        examples={examples.map((ex) => ({
          label: ex.label,
          onClick: () => { setOp("wide2long"); setKey(ex.key); setBring(ex.bring); },
        }))}
      />
      <div className="wizard-q">
        <p className="wizard-label">What do you want to do?</p>
        <select value={op} onChange={(e) => { setOp(e.target.value); setBring([]); }}>
          <option value="">choose an operation…</option>
          {OPS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {opDef?.needsB && sheets.length < 2 && (
        <p className="hint">This needs a second sheet, and your file has only one. Upload a workbook with two sheets to use it.</p>
      )}

      {opDef && (
        <div className="shelf-config">
          {opDef.needsB && sheets.length >= 2 && (
            <label className="shelf-field">Other sheet
              <select value={bSheet} onChange={(e) => setBSheet(e.target.value)}>
                {sheets.slice(1).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </label>
          )}

          {(op === "antijoin" || op === "lookup" || op === "asof") && (
            <label className="shelf-field">Shared column (the key)
              <select value={key} onChange={(e) => setKey(e.target.value)}>
                <option value="">choose…</option>
                {aCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          {op === "asof" && (
            <label className="shelf-field">Date column
              <select value={time} onChange={(e) => setTime(e.target.value)}>
                <option value="">choose…</option>
                {aCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          {op === "explode" && (
            <>
              <label className="shelf-field">First list column
                <select value={colX} onChange={(e) => setColX(e.target.value)}><option value="">choose…</option>{aCols.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </label>
              <label className="shelf-field">Second list column (paired)
                <select value={colY} onChange={(e) => setColY(e.target.value)}><option value="">choose…</option>{aCols.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </label>
            </>
          )}
          {op === "long2wide" && (
            <>
              <label className="shelf-field">Patient column
                <select value={key} onChange={(e) => setKey(e.target.value)}><option value="">choose…</option>{aCols.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </label>
              <label className="shelf-field">Measure name column
                <select value={colX} onChange={(e) => setColX(e.target.value)}><option value="">choose…</option>{aCols.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </label>
              <label className="shelf-field">Measure value column
                <select value={colY} onChange={(e) => setColY(e.target.value)}><option value="">choose…</option>{aCols.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </label>
            </>
          )}
          {op === "wide2long" && (
            <label className="shelf-field">Patient column
              <select value={key} onChange={(e) => setKey(e.target.value)}><option value="">choose…</option>{aCols.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </label>
          )}

          {(op === "lookup" || op === "asof") && B && (
            <div className="shelf-field">Columns to bring from {B.name}
              <div className="col-privacy">
                {bCols.map((c) => (
                  <label key={c} className={`col-chip ${bring.includes(c) ? "" : "col-chip-off"}`}>
                    <input type="checkbox" checked={bring.includes(c)} onChange={() => toggleBring(c)} />{c}
                  </label>
                ))}
              </div>
            </div>
          )}
          {op === "wide2long" && (
            <div className="shelf-field">Columns to turn into rows
              <div className="col-privacy">
                {aCols.filter((c) => c !== key).map((c) => (
                  <label key={c} className={`col-chip ${bring.includes(c) ? "" : "col-chip-off"}`}>
                    <input type="checkbox" checked={bring.includes(c)} onChange={() => toggleBring(c)} />{c}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {result?.error && <div className="error-box">{result.error}</div>}

      {result && !result.error && (
        <div className="shelf-result">
          <p className="stats-testname"><strong>{result.rows.length} rows.</strong>{result.flagText}</p>
          {result.flagRows?.length > 0 && (
            <div className="notice-box" role="status" aria-live="polite">
              {result.flagRows.length} row{result.flagRows.length === 1 ? "" : "s"} {result.flagLabel} — decide what to do with them. Nothing was dropped or guessed.
            </div>
          )}
          {result.collisionCount > 0 && (
            <div className="notice-box" role="status" aria-live="polite">
              {result.collisionCount} value{result.collisionCount === 1 ? " was" : "s were"} overwritten because the same "{key}" had the same measure more than once — the last one won; check these before trusting the table.
            </div>
          )}
          {result.rows.length > 0 && <DataTable rows={result.rows} maxRows={100} />}
          <div className="row-end" style={{ marginTop: "0.5rem" }}>
            <button className="btn btn-primary" onClick={() => downloadRowsAsXlsx(result.rows, "TidyTable_reshaped.xlsx")} disabled={result.rows.length === 0}>
              Download result (.xlsx)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function single(rows) {
  return { rows, flagText: "", flagRows: [] };
}
function withFlag(res, flagKey, flagText) {
  return { rows: res.rows, flagText: res[flagKey].length ? ` ${res[flagKey].length} ${flagText}.` : "", flagRows: res[flagKey], flagLabel: flagText };
}
