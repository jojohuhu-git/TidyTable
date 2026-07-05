import { useState } from "react";
import {
  deidentifyStep, reportCardsStep, serializeRecipe, saveRecipe, isTerminal,
} from "../logic/recipes/recipe.js";
import { downloadText } from "../logic/workbook.js";

// Step 5 (build prompt §7): build a reusable monthly recipe. The cleaning steps
// you applied above are recorded automatically; here you can add the two steps
// that make a monthly report — swap names for codes, and make report cards — then
// save the recipe so you can replay it on next month's file.
export default function RecipePanel({ recipe, sheet, onChange, onSaved }) {
  const [name, setName] = useState(recipe.name);
  const [idCol, setIdCol] = useState("");
  const [personCol, setPersonCol] = useState("");
  const [valueCol, setValueCol] = useState("");
  const [groupCol, setGroupCol] = useState("");
  const [saved, setSaved] = useState(false);

  const columns = sheet.headers.map((h) => h.name);
  const numericColumns = sheet.headers.filter((h) => h.type === "number").map((h) => h.name);
  const withoutTerminal = recipe.steps.filter((s) => !isTerminal(s));
  const terminal = recipe.steps.find(isTerminal) || null;

  function replaceSteps(steps) {
    onChange({ ...recipe, name: name.trim() || recipe.name, steps });
    setSaved(false);
  }

  function addDeidentify() {
    if (!idCol) return;
    const next = [...withoutTerminal, deidentifyStep(idCol)];
    if (terminal) next.push(terminal);
    replaceSteps(next);
    setIdCol("");
  }

  function setReportCards() {
    if (!personCol) return;
    const step = reportCardsStep({ personColumn: personCol, valueColumn: valueCol || null, groupColumn: groupCol || null });
    replaceSteps([...withoutTerminal, step]);
  }

  function removeStep(index) {
    replaceSteps(recipe.steps.filter((_, i) => i !== index));
  }

  function save() {
    const toSave = { ...recipe, name: name.trim() || "Monthly cleanup" };
    saveRecipe(toSave);
    onChange(toSave);
    setSaved(true);
    if (onSaved) onSaved(toSave);
  }

  function exportFile() {
    const toSave = { ...recipe, name: name.trim() || "Monthly cleanup" };
    downloadText(serializeRecipe(toSave), `${toSave.name.replace(/[^\w -]/g, "").trim() || "recipe"}.tidytable-recipe.json`);
  }

  return (
    <div className="recipe-panel">
      {recipe.steps.length === 0 ? (
        <p className="empty-state">
          Nothing recorded yet. Apply a fix in the checkup above and it will be added here as a
          step. You can then add a step that swaps names for codes and a final step that makes
          report cards, and save the whole thing to reuse next month.
        </p>
      ) : (
        <ol className="recipe-steps">
          {recipe.steps.map((s, i) => (
            <li key={i} className="recipe-step">
              <span>{s.label}</span>
              <button type="button" className="finding-dismiss" onClick={() => removeStep(i)}>Remove</button>
            </li>
          ))}
        </ol>
      )}

      <div className="recipe-add">
        <div className="recipe-add-row">
          <label>
            Swap names for codes in
            <select value={idCol} onChange={(e) => setIdCol(e.target.value)}>
              <option value="">choose a column…</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={addDeidentify} disabled={!idCol}>Add this step</button>
        </div>
        <p className="dim">
          The real names are kept only in a private code list on this computer. Reports show codes,
          never names, and the codes stay the same each month so you can follow each person over time.
        </p>

        <div className="recipe-add-row">
          <label>
            Report cards, one per person in
            <select value={personCol} onChange={(e) => setPersonCol(e.target.value)}>
              <option value="">choose a column…</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            measured by
            <select value={valueCol} onChange={(e) => setValueCol(e.target.value)}>
              <option value="">how many rows each has</option>
              {numericColumns.map((c) => <option key={c} value={c}>total {c}</option>)}
            </select>
          </label>
          <label>
            grouped by
            <select value={groupCol} onChange={(e) => setGroupCol(e.target.value)}>
              <option value="">no grouping</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={setReportCards} disabled={!personCol}>
            {terminal ? "Update report cards" : "Add report cards"}
          </button>
        </div>
      </div>

      <div className="recipe-save-row">
        <label className="recipe-name">
          Recipe name
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="Monthly cleanup" />
        </label>
        <button type="button" className="btn btn-primary" onClick={save} disabled={recipe.steps.length === 0}>Save to this browser</button>
        <button type="button" className="btn btn-ghost" onClick={exportFile} disabled={recipe.steps.length === 0}>Export to a file</button>
        {saved && <span className="dim">Saved.</span>}
      </div>
    </div>
  );
}
