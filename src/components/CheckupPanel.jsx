import { useMemo, useState } from "react";
import { checkupSheet } from "../logic/checkup/scan.js";
import ClarifyBox from "./ClarifyBox.jsx";
import StepHelpPanel from "./StepHelpPanel.jsx";

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
  // A6: findingId -> { groupIndex: chosenCanonicalValue }. Defaults to each
  // group's most-common spelling (f.groups[i].canonical) until overridden.
  const [canonicalChoices, setCanonicalChoices] = useState({});

  function chooseCanonical(findingId, groupIndex, value) {
    setCanonicalChoices((c) => ({
      ...c,
      [findingId]: { ...(c[findingId] || {}), [groupIndex]: value },
    }));
  }

  // A6: rebuild the trimCase map from each group's chosen canonical spelling
  // (default or user-picked), instead of always using the scan's default.
  function fixParams(f) {
    if (f.type === "categoryVariants" && f.groups) {
      const overrides = canonicalChoices[f.id] || {};
      const map = {};
      f.groups.forEach((g, gi) => {
        const canonical = overrides[gi] ?? g.canonical;
        for (const v of g.variants) {
          if (v.value !== canonical) map[v.value] = canonical;
        }
      });
      return { map };
    }
    return { ...(f.fix.params || {}) };
  }

  const visible = findings.filter((f) => !dismissed.has(f.id));
  const fixable = visible.filter((f) => f.fixable);
  const flags = visible.filter((f) => !f.fixable);
  // P2-2: "safe" fixes never ask a policy question — nothing is lost or
  // judged, so they can all be ticked in one click. Anything that needs a
  // policy answer (date order, below/above-limit results) is the user's call.
  const safeFixable = fixable.filter((f) => !f.fix?.needsPolicy);
  const callFixable = fixable.filter((f) => f.fix?.needsPolicy);

  function tickAllSafe() {
    setSelected((s) => {
      const next = new Set(s);
      for (const f of safeFixable) next.add(f.id);
      return next;
    });
  }

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
        const fix = { normalizer: f.fix.normalizer, column: f.column, params: fixParams(f) };
        if (f.fix.needsPolicy) fix.params[f.fix.paramKey || "policy"] = policies[f.id];
        return fix;
      });
    onApply(fixes);
  }

  // P2-4: no clickable "Try these" here — this step has no free-text box to
  // fill, and P2-3 (the plain-English cleaning box that WOULD give the chips
  // something to run) hasn't shipped yet. A fake action would be dishonest.
  const helpPanel = (
    <StepHelpPanel
      whatItDoes="Automatically scans your first sheet for common problems — duplicates, missing values, numbers stored as text, mixed date formats, spelling variants, impossible values, limit results, and packed cells — so you can tick the ones you want fixed."
      cantDoYet={["Only checks the first sheet.", "Nothing changes until you tick a fix and press Apply."]}
    />
  );

  if (visible.length === 0) {
    return (
      <div>
        {helpPanel}
        <p className="empty-state">
          No common data problems were found in this sheet. You can move on to describing what
          you want. (This check looks for duplicates, missing values, numbers stored as text,
          mixed date formats, spelling variants, impossible values, limit results, and packed
          cells.)
        </p>
      </div>
    );
  }

  function renderFixable(f) {
    return (
      <li key={f.id} className="finding">
        <div className="finding-line">
          <label className="finding-head">
            <input
              type="checkbox"
              checked={selected.has(f.id)}
              onChange={() => toggle(f)}
              disabled={busy}
            />
            <span className="finding-title">{f.title}</span>
          </label>
          <span className="finding-count">{f.count} affected</span>
          <button type="button" className="finding-dismiss" onClick={() => dismiss(f)} disabled={busy}>
            Skip
          </button>
        </div>
        <details className="finding-expander">
          <summary>What's this?</summary>
          <p className="finding-detail">{f.detail}</p>
          {f.type === "categoryVariants" && f.groups?.length > 0 ? (
            <div className="variant-groups">
              {f.groups.map((g, gi) => {
                const chosen = canonicalChoices[f.id]?.[gi] ?? g.canonical;
                return (
                  <div key={gi} className="variant-group">
                    <span className="dim">Merge into: </span>
                    {g.variants.map((v) => (
                      <button
                        key={v.value}
                        type="button"
                        className={`variant-chip ${chosen === v.value ? "variant-chip-active" : ""}`}
                        aria-pressed={chosen === v.value}
                        onClick={() => chooseCanonical(f.id, gi, v.value)}
                        disabled={busy}
                      >
                        {v.value} ({v.count})
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            f.samples?.length > 0 && (
              <div className="finding-samples">
                {f.samples.map((s, i) => <span key={i} className="sample-chip">{String(s)}</span>)}
              </div>
            )
          )}
        </details>
        {askingPolicy === f.id && (
          <ClarifyBox
            question={f.fix.policyQuestion || `How should the below/above-limit results in "${f.column}" be counted?`}
            options={f.fix.policyOptions || CENSORED_OPTIONS}
            onAnswer={(v) => answerPolicy(f.id, v)}
            onCancel={() => setAskingPolicy(null)}
          />
        )}
        {policies[f.id] && (
          <p className="dim">
            Chosen: {(f.fix.policyOptions || CENSORED_OPTIONS).find((o) => o.value === policies[f.id])?.label.toLowerCase()}.
          </p>
        )}
      </li>
    );
  }

  return (
    <div>
      {helpPanel}
      {safeFixable.length > 0 && (
        <section className="finding-group">
          <div className="finding-group-head">
            <h3>Safe fixes — nothing is lost</h3>
            <button type="button" className="btn btn-ghost" onClick={tickAllSafe} disabled={busy}>
              Tick all safe fixes
            </button>
          </div>
          <ul className="findings">{safeFixable.map(renderFixable)}</ul>
        </section>
      )}

      {callFixable.length > 0 && (
        <section className="finding-group">
          <h3>Needs your call</h3>
          <ul className="findings">{callFixable.map(renderFixable)}</ul>
        </section>
      )}

      {flags.length > 0 && (
        <section className="finding-group">
          <h3>For your review</h3>
          <ul className="findings">
            {flags.map((f) => (
              <li key={f.id} className="finding finding-flag">
                <div className="finding-line">
                  <span className="finding-title">{f.title}</span>
                  <span className="finding-count">for your review</span>
                  <button type="button" className="finding-dismiss" onClick={() => dismiss(f)} disabled={busy}>
                    Skip
                  </button>
                </div>
                <details className="finding-expander">
                  <summary>What's this?</summary>
                  <p className="finding-detail">{f.detail}</p>
                  {f.samples?.length > 0 && (
                    <div className="finding-samples">
                      {f.samples.map((s, i) => <span key={i} className="sample-chip">{String(s)}</span>)}
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

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
