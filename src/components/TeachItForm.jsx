import { useState } from "react";

// Phase 7.9 (plan-2026-07-10-offline-smarts.md) — the teach-it form on decline.
//
// When the offline engine can't place a request AND the user has no API key,
// the plain "I can't answer this" dead-ends. This two-field mini-form lets a
// novice tell the app what a word means — either "this word means the X column"
// (a learned column alias, exactly the Phase 3 store) or "these specific values
// in X" (a definition) — and the question re-runs immediately. No Excel round
// trip, no jargon.
export default function TeachItForm({ request, columns, onTeachColumn, onTeachValues, onCancel }) {
  const [phrase, setPhrase] = useState(request || "");
  const [mode, setMode] = useState("column"); // "column" | "values"
  const [columnName, setColumnName] = useState("");
  const [values, setValues] = useState("");

  const canSubmit = phrase.trim() && columnName
    && (mode === "column" || values.trim());

  function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    if (mode === "column") onTeachColumn(phrase.trim(), columnName);
    else onTeachValues(phrase.trim(), columnName, values.trim());
  }

  return (
    <form className="teach-it-form" onSubmit={submit} aria-label="Teach the app what a word means">
      <p className="hint">
        No API key needed — tell me what a word means and I'll remember it for this file, then
        answer your question.
      </p>

      <label className="field-label" htmlFor="teach-phrase">When I say</label>
      <input
        id="teach-phrase"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder="e.g. antibiotic"
      />

      <fieldset className="teach-mode">
        <legend className="field-label">I mean…</legend>
        <label>
          <input type="radio" name="teach-mode" checked={mode === "column"} onChange={() => setMode("column")} />
          {" "}the whole column
        </label>
        <label>
          <input type="radio" name="teach-mode" checked={mode === "values"} onChange={() => setMode("values")} />
          {" "}specific values in a column
        </label>
      </fieldset>

      <label className="field-label" htmlFor="teach-column">Column</label>
      <select id="teach-column" value={columnName} onChange={(e) => setColumnName(e.target.value)}>
        <option value="">choose a column…</option>
        {(columns || []).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      {mode === "values" && (
        <>
          <label className="field-label" htmlFor="teach-values">Values that count (comma-separated)</label>
          <input
            id="teach-values"
            value={values}
            onChange={(e) => setValues(e.target.value)}
            placeholder="cephalexin, amoxicillin, cefpodoxime"
          />
        </>
      )}

      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Not now</button>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          Remember this and ask again
        </button>
      </div>
    </form>
  );
}
