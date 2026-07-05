import { useMemo, useState } from "react";
import { checkupSheet } from "../logic/checkup/scan.js";
import ClarifyBox from "./ClarifyBox.jsx";

const CENSORED_OPTIONS = [
  { value: "boundary", label: "Use the limit number", detail: "treat \"<0.5\" as 0.5" },
  { value: "missing", label: "Treat as missing", detail: "leave these blank so they are not counted" },
  { value: "exclude", label: "Leave them as-is", detail: "keep the text and exclude these rows later" },
];

// Step 2 (build prompt §6): show what the scan found and let the user pick which
// fixes to apply. Nothing is changed until "Apply selected fixes" is pressed.
export default function CheckupPanel({ sheet, busy, onApply }) {
  const findings = useMemo(() => checkupSheet(sheet), [sheet]);
  const [selected, setSelected] = useState(() => new Set());
  const [dismissed, setDismissed] = useState(() => new Set());
  const [policies, setPolicies] = useState({}); // findingId -> policy
  const [askingPolicy, setAskingPolicy] = useState(null); // findingId

  const visible = findings.filter((f) => !dismissed.has(f.id));
  const fixable = visible.filter((f) => f.fixable);
  const flags = visible.filter((f) => !f.fixable);

  function toggle(f) {
    if (selected.has(f.id)) {
      const next = new Set(selected);
      next.delete(f.id);
      setSelected(next);
      return;
    }
    if (f.fix?.needsPolicy && !policies[f.id]) {
      setAskingPolicy(f.id); // must answer the policy question before selecting
      return;
    }
    setSelected(new Set(selected).add(f.id));
  }

  function answerPolicy(findingId, value) {
    setPolicies((p) => ({ ...p, [findingId]: value }));
    setSelected((s) => new Set(s).add(findingId));
    setAskingPolicy(null);
  }

  function dismiss(f) {
    setDismissed(new Set(dismissed).add(f.id));
    if (selected.has(f.id)) {
      const next = new Set(selected);
      next.delete(f.id);
      setSelected(next);
    }
  }

  function apply() {
    const fixes = fixable
      .filter((f) => selected.has(f.id))
      .map((f) => {
        const fix = { normalizer: f.fix.normalizer, column: f.column, params: { ...(f.fix.params || {}) } };
        if (f.fix.needsPolicy) fix.params.policy = policies[f.id];
        return fix;
      });
    onApply(fixes);
  }

  if (visible.length === 0) {
    return (
      <p className="empty-state">
        No common data problems were found in this sheet. You can move on to describing what
        you want. (This check looks for duplicates, missing values, numbers stored as text,
        mixed date formats, spelling variants, impossible values, limit results, and packed
        cells.)
      </p>
    );
  }

  return (
    <div>
      <ul className="findings">
        {fixable.map((f) => (
          <li key={f.id} className="finding">
            <label className="finding-head">
              <input
                type="checkbox"
                checked={selected.has(f.id)}
                onChange={() => toggle(f)}
                disabled={busy}
              />
              <span className="finding-title">{f.title}</span>
              <span className="finding-count">{f.count} affected</span>
            </label>
            <p className="finding-detail">{f.detail}</p>
            {f.samples?.length > 0 && (
              <div className="finding-samples">
                {f.samples.map((s, i) => <span key={i} className="sample-chip">{String(s)}</span>)}
              </div>
            )}
            {askingPolicy === f.id && (
              <ClarifyBox
                question={`How should the below/above-limit results in "${f.column}" be counted?`}
                options={CENSORED_OPTIONS}
                onAnswer={(v) => answerPolicy(f.id, v)}
                onCancel={() => setAskingPolicy(null)}
              />
            )}
            {policies[f.id] && (
              <p className="dim">
                Chosen: {CENSORED_OPTIONS.find((o) => o.value === policies[f.id])?.label.toLowerCase()}.
              </p>
            )}
            <button type="button" className="finding-dismiss" onClick={() => dismiss(f)} disabled={busy}>
              Dismiss
            </button>
          </li>
        ))}

        {flags.map((f) => (
          <li key={f.id} className="finding finding-flag">
            <div className="finding-head">
              <span className="finding-title">{f.title}</span>
              <span className="finding-count">for your review</span>
            </div>
            <p className="finding-detail">{f.detail}</p>
            {f.samples?.length > 0 && (
              <div className="finding-samples">
                {f.samples.map((s, i) => <span key={i} className="sample-chip">{String(s)}</span>)}
              </div>
            )}
            <button type="button" className="finding-dismiss" onClick={() => dismiss(f)} disabled={busy}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>

      <div className="run-row">
        <button className="btn btn-primary" onClick={apply} disabled={busy || selected.size === 0}>
          {busy ? "Applying…" : `Apply ${selected.size} selected fix${selected.size === 1 ? "" : "es"}`}
        </button>
        <span className="dim">
          Only the fixes you tick are applied. Everything runs on this computer; nothing is sent anywhere.
        </span>
      </div>
    </div>
  );
}
