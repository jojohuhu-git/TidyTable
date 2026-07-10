import { useState } from "react";
import { buildDefinitionEntry } from "../logic/offline/definitions.js";

// B7: shown in place of a plain decline when a question is blocked on a
// clinical term the app won't guess. One small form per missing term — type
// what it means, and the same question re-runs automatically. No Excel
// round-trip required (a real Definitions sheet is still fully honored).
export default function DefinitionsEditor({ missingTerms, message, onAdd, onCancel, columns }) {
  const [term, setTerm] = useState(missingTerms?.[0]?.term || "");
  const [columnName, setColumnName] = useState(missingTerms?.[0]?.wantedColumn || "");
  const [rule, setRule] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!term.trim() || !rule.trim()) return;
    onAdd(buildDefinitionEntry(term, columnName, rule));
  }

  return (
    <form className="definitions-editor" onSubmit={submit} aria-label="Define a clinical term">
      <p className="clarify-q">{message}</p>
      <p className="hint">
        Or define it here instead of editing a Definitions sheet — this re-runs your question
        automatically.
      </p>
      <label className="field-label" htmlFor="def-term">Term</label>
      <input id="def-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="oral beta-lactam" />

      <label className="field-label" htmlFor="def-column">Column it applies to</label>
      {columns?.length ? (
        <select id="def-column" value={columnName} onChange={(e) => setColumnName(e.target.value)}>
          <option value="">choose a column…</option>
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : (
        <input id="def-column" value={columnName} onChange={(e) => setColumnName(e.target.value)} placeholder="Drug" />
      )}

      <label className="field-label" htmlFor="def-rule">Values that count (or a rule like "&gt; 7 when Diagnosis = pyelonephritis")</label>
      <input
        id="def-rule"
        value={rule}
        onChange={(e) => setRule(e.target.value)}
        placeholder="cephalexin, amoxicillin, cefpodoxime"
      />

      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Not now</button>
        <button type="submit" className="btn btn-primary" disabled={!term.trim() || !rule.trim()}>
          Add definition and ask again
        </button>
      </div>
    </form>
  );
}
