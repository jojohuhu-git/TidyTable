import { useState } from "react";
import { MODELS } from "../logic/claude.js";

export default function ApiKeyPanel({ apiKey, setApiKey, model, setModel }) {
  const [open, setOpen] = useState(!apiKey);
  const [draft, setDraft] = useState(apiKey);
  const [remember, setRemember] = useState(true);

  function save() {
    const key = draft.trim();
    setApiKey(key);
    if (remember && key) localStorage.setItem("tidytable_api_key", key);
    else localStorage.removeItem("tidytable_api_key");
    setOpen(false);
  }

  function saveModel(m) {
    setModel(m);
    localStorage.setItem("tidytable_model", m);
  }

  return (
    <div className="keypanel">
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
        {apiKey ? "AI settings ✓" : "Set up AI key"}
      </button>
      {open && (
        <div className="keypanel-pop">
          <h3>Connect to Claude</h3>
          <p>
            TidyTable uses Anthropic's Claude AI with <strong>your own API key</strong>.
            Get one at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>{" "}
            (a few dollars of credit lasts a long time — typical requests cost a few cents).
          </p>
          <label className="field-label" htmlFor="api-key-input">API key</label>
          <input
            id="api-key-input"
            type="password"
            placeholder="sk-ant-…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
          />
          <label className="check-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember on this computer (stored only in this browser)
          </label>
          <label className="field-label" htmlFor="model-select">AI model</label>
          <select id="model-select" value={model} onChange={(e) => saveModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <div className="row-end">
            <button className="btn btn-primary" onClick={save} disabled={!draft.trim()}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
