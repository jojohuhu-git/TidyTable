import { useMemo, useState } from "react";
import { assessRegression, methodName } from "../logic/stats/epvWizard.js";
import { rRegression } from "../logic/rscripts/templates.js";
import { downloadText } from "../logic/workbook.js";
import { columnPickerOptions } from "../logic/columnPickerOptions.js";

// Step 8 (build prompt §9): the appropriateness double-check before any
// regression script. Three plain questions and an events-per-variable check
// computed from the numbers you give. It recommends the right method or declines
// — it never writes a script it just argued against.
export default function RegressionWizard({ sheet }) {
  // B10: badge each option by type/cardinality and put the columns most
  // likely to fit the role first, same idea as StatsPanel.
  const predictorOptions = useMemo(() => columnPickerOptions(sheet, "any"), [sheet]);
  const numericFirstOptions = useMemo(() => columnPickerOptions(sheet, "outcome"), [sheet]);
  const groupingFirstOptions = useMemo(() => columnPickerOptions(sheet, "grouping"), [sheet]);
  const [outcomeType, setOutcomeType] = useState("");
  const [repeated, setRepeated] = useState("");
  const [events, setEvents] = useState("");
  const [predictors, setPredictors] = useState([]);
  const [outcomeCol, setOutcomeCol] = useState("");
  const [timeCol, setTimeCol] = useState("");
  const [eventCol, setEventCol] = useState("");

  const ready = outcomeType && repeated && events !== "" && predictors.length > 0;

  const verdict = useMemo(() => {
    if (!ready) return null;
    return assessRegression({
      outcomeType,
      repeated: repeated === "yes",
      events: Number(events),
      predictors: predictors.length,
    });
  }, [ready, outcomeType, repeated, events, predictors]);

  const script = useMemo(() => {
    if (!verdict || verdict.decision !== "proceed" || !outcomeCol) return null;
    if (verdict.method === "survival" && (!timeCol || !eventCol)) return null;
    return rRegression(verdict.method, { outcomeCol, timeCol, eventCol, predictors });
  }, [verdict, outcomeCol, timeCol, eventCol, predictors]);

  function togglePredictor(name) {
    setPredictors((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  }

  return (
    <div className="wizard">
      <div className="wizard-q">
        <p className="wizard-label">1. What kind of outcome are you predicting?</p>
        <select value={outcomeType} onChange={(e) => setOutcomeType(e.target.value)}>
          <option value="">choose…</option>
          <option value="yesno">A yes/no result (e.g. died, readmitted)</option>
          <option value="measurement">A measurement (e.g. length of stay in days)</option>
          <option value="time">Time until something happens (e.g. days to event)</option>
        </select>
      </div>

      <div className="wizard-q">
        <p className="wizard-label">2. Are the same patients measured more than once, or matched to each other?</p>
        <select value={repeated} onChange={(e) => setRepeated(e.target.value)}>
          <option value="">choose…</option>
          <option value="no">No — each patient appears once</option>
          <option value="yes">Yes — repeated or matched</option>
        </select>
      </div>

      <div className="wizard-q">
        <p className="wizard-label">
          3. How many patients had the outcome{outcomeType === "measurement" ? " measured" : ""}?
        </p>
        <input
          type="number"
          min="0"
          value={events}
          onChange={(e) => setEvents(e.target.value)}
          placeholder={outcomeType === "measurement" ? "number of patients" : "number of outcome events"}
        />
      </div>

      <div className="wizard-q">
        <p className="wizard-label">Which variables do you want in the model? ({predictors.length} chosen)</p>
        <div className="col-privacy">
          {predictorOptions.map((o) => (
            <label key={o.name} className={`col-chip ${predictors.includes(o.name) ? "" : "col-chip-off"}`}>
              <input type="checkbox" checked={predictors.includes(o.name)} onChange={() => togglePredictor(o.name)} />
              {o.name} <span className="dim">({o.badge})</span>
            </label>
          ))}
        </div>
      </div>

      {verdict && (
        <div className={verdict.decision === "proceed" ? "notice-box" : "error-box"} role="status">
          {verdict.decision === "proceed"
            ? `This looks reasonable: a ${methodName(verdict.method)}. ${verdict.message}`
            : verdict.message}
        </div>
      )}

      {verdict && verdict.decision === "proceed" && (
        <div className="wizard-script">
          <ul className="stats-checklist">
            {verdict.checklist.map((c, i) => <li key={i}>{c}</li>)}
          </ul>

          <div className="wizard-q">
            <p className="wizard-label">Which column is the outcome?</p>
            <select value={outcomeCol} onChange={(e) => setOutcomeCol(e.target.value)}>
              <option value="">choose…</option>
              {(outcomeType === "measurement" ? numericFirstOptions : groupingFirstOptions).map((o) => (
                <option key={o.name} value={o.name}>{o.name} ({o.badge})</option>
              ))}
            </select>
          </div>

          {verdict.method === "survival" && (
            <div className="wizard-q">
              <p className="wizard-label">For a time-to-event model, which column is the follow-up time, and which marks the event (1/0)?</p>
              <select value={timeCol} onChange={(e) => setTimeCol(e.target.value)}>
                <option value="">follow-up time column…</option>
                {numericFirstOptions.map((o) => <option key={o.name} value={o.name}>{o.name} ({o.badge})</option>)}
              </select>
              <select value={eventCol} onChange={(e) => setEventCol(e.target.value)}>
                <option value="">event marker column…</option>
                {groupingFirstOptions.map((o) => <option key={o.name} value={o.name}>{o.name} ({o.badge})</option>)}
              </select>
            </div>
          )}

          {script && (
            <>
              <div className="summary-box"><p style={{ whiteSpace: "pre-wrap" }}>{script.r_run_notes}</p></div>
              <div className="row-end" style={{ margin: "0.4rem 0" }}>
                <button className="btn btn-primary" onClick={() => downloadText(script.script, "tidytable_regression.R")}>
                  Download script (.R)
                </button>
              </div>
              <pre className="code-block"><code>{script.script}</code></pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
