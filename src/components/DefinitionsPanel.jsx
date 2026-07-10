import { useRef, useState } from "react";
import { downloadText } from "../logic/workbook.js";
import {
  removeDefinitionEntry, serializeDefinitionsStore, parseDefinitionsStoreFile,
} from "../logic/offline/definitionsStore.js";

// B7: lets the definitions typed in this session travel with the user —
// export to a JSON file (mirrors the recipe export pattern) and re-import on
// another computer or a later session, instead of having to retype them.
export default function DefinitionsPanel({ store, onChange }) {
  const [importError, setImportError] = useState("");
  const fileInput = useRef(null);

  if (!store?.entries?.length) return null;

  function exportFile() {
    downloadText(serializeDefinitionsStore(store), "TidyTable_definitions.json");
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError("");
    try {
      const imported = parseDefinitionsStoreFile(await file.text());
      // Imported entries win on a term collision, same rule as adding one by hand.
      const merged = { entries: [...store.entries.filter((existing) => !imported.entries.some((i) => i.term === existing.term)), ...imported.entries] };
      onChange(merged);
    } catch (err) {
      setImportError(err.message || "Could not read that definitions file.");
    }
  }

  return (
    <div className="definitions-panel">
      <p className="dim">
        {store.entries.length} definition{store.entries.length === 1 ? "" : "s"} added this session:
      </p>
      <ul className="definitions-list">
        {store.entries.map((e) => (
          <li key={e.term}>
            <strong>{e.term}</strong>
            {e.columnName && <span className="dim"> ({e.columnName})</span>}
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => onChange(removeDefinitionEntry(store, e.term))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={() => fileInput.current?.click()}>
          Import definitions
        </button>
        <input ref={fileInput} type="file" accept=".json" hidden onChange={onImportFile} />
        <button type="button" className="btn btn-ghost" onClick={exportFile}>
          Export definitions
        </button>
      </div>
      {importError && <div className="error-box">{importError}</div>}
    </div>
  );
}
