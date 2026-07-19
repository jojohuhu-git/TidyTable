import { useRef, useState } from "react";
import { parseWorkbookFile } from "../logic/workbook.js";
import DataTable from "./DataTable.jsx";
import { nextTabIndex } from "../logic/a11y/tabsKeyboard.js";

export default function UploadPanel({
  workbook,
  onWorkbook,
  excluded,
  setExcluded,
  privacyMode,
  setPrivacyMode,
  phiMode,
  setPhiMode,
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState("");
  const [activeSheet, setActiveSheet] = useState(0);
  const sheetTabRefs = useRef([]);

  // B12: standard tablist keyboard support for the sheet tabs.
  function onSheetTabKeyDown(e, index, count) {
    const next = nextTabIndex(e.key, index, count);
    if (next == null) return;
    e.preventDefault();
    setActiveSheet(next);
    sheetTabRefs.current[next]?.focus();
  }

  async function handleFile(file) {
    if (!file) return;
    setParseError("");
    try {
      const wb = await parseWorkbookFile(file);
      onWorkbook(wb);
      setActiveSheet(0);
    } catch (err) {
      setParseError(err.message || "Could not read that file.");
    }
  }

  function toggleColumn(sheetName, colName) {
    const key = `${sheetName}::${colName}`;
    const next = new Set(excluded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExcluded(next);
  }

  const sheet = workbook?.sheets[Math.min(activeSheet, (workbook?.sheets.length || 1) - 1)];

  return (
    <div>
      <div
        className={`dropzone ${dragOver ? "dropzone-active" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {workbook ? (
          <span><strong>{workbook.fileName}</strong> loaded — click to replace it</span>
        ) : (
          <span>Drag an Excel file here, or <strong>click to browse</strong> (.xlsx, .xls, .csv)</span>
        )}
      </div>
      {parseError && <div className="error-box">{parseError}</div>}

      {workbook && sheet && (
        <>
          {workbook.sheets.length > 1 && (
            <div className="tabs" role="tablist">
              {workbook.sheets.map((s, i) => (
                <button
                  key={s.name}
                  ref={(el) => (sheetTabRefs.current[i] = el)}
                  id={`sheet-tab-${i}`}
                  role="tab"
                  aria-selected={i === activeSheet}
                  aria-controls="sheet-preview-panel"
                  tabIndex={i === activeSheet ? 0 : -1}
                  className={`tab ${i === activeSheet ? "tab-active" : ""}`}
                  onClick={() => setActiveSheet(i)}
                  onKeyDown={(e) => onSheetTabKeyDown(e, i, workbook.sheets.length)}
                >
                  {s.name} <span className="dim">({s.rowCount.toLocaleString()})</span>
                </button>
              ))}
            </div>
          )}

          <div
            id="sheet-preview-panel"
            role={workbook.sheets.length > 1 ? "tabpanel" : undefined}
            aria-labelledby={workbook.sheets.length > 1 ? `sheet-tab-${activeSheet}` : undefined}
          >
          <p className="hint">
            Preview of <strong>{sheet.name}</strong> — {sheet.rowCount.toLocaleString()} rows.
            Untick any sensitive column below to keep its values on your computer
            (the AI will still know the column exists, but never sees what's inside).
          </p>

          <div className="col-privacy">
            {sheet.headers.map((h) => {
              const key = `${sheet.name}::${h.name}`;
              const shared = !excluded.has(key);
              return (
                <label key={key} className={`col-chip ${shared ? "" : "col-chip-off"}`}>
                  <input
                    type="checkbox"
                    checked={shared}
                    onChange={() => toggleColumn(sheet.name, h.name)}
                  />
                  <span className="col-letter">{h.letter}</span> {h.name}
                </label>
              );
            })}
          </div>

          <DataTable
            rows={sheet.rows.slice(0, 8)}
            columns={sheet.headers.map((h) => h.name)}
            maskedColumns={new Set(
              sheet.headers.filter((h) => excluded.has(`${sheet.name}::${h.name}`)).map((h) => h.name),
            )}
          />

          <fieldset className="privacy-modes">
            <legend>What gets sent to the AI?</legend>
            {/* Parked item 3e: PHI mode, asked for after the HIPAA review.
                While on, the whole-spreadsheet AI option is off and the
                results list is not saved in browser storage between visits. */}
            <label className="radio-row phi-mode-row">
              <input
                type="checkbox"
                checked={Boolean(phiMode)}
                onChange={(e) => setPhiMode(e.target.checked)}
                aria-label="PHI mode — this file holds real patient data"
              />
              <span>
                <strong>PHI mode</strong> — tick this when the file holds real patient data. It turns
                off the "whole spreadsheet" AI option below, and stops saving your results list in
                this browser between visits. Cleaning and charts already run only on this computer.
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="privacy"
                checked={privacyMode === "sample"}
                onChange={() => setPrivacyMode("sample")}
              />
              <span>
                <strong>Column names + 10 sample rows</strong> (recommended) — the AI writes the
                extraction logic from a small sample; all real processing happens in your browser.
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="privacy"
                checked={privacyMode === "full"}
                disabled={Boolean(phiMode)}
                onChange={() => {
                  // B8: full mode sends every cell value to Anthropic — a
                  // one-time confirm before switching to it, so it's never a
                  // silent radio click.
                  if (window.confirm(
                    "This sends every value in the spreadsheet to Anthropic using your key — OK?",
                  )) {
                    setPrivacyMode("full");
                  }
                }}
              />
              <span>
                <strong>The whole spreadsheet</strong> — lets the AI see every value (useful for
                fixing typos or messy categories), but your data leaves your computer and large
                files cost more.
                {phiMode ? " Turned off while PHI mode is on." : ""}
              </span>
            </label>
          </fieldset>
          </div>
        </>
      )}
    </div>
  );
}
