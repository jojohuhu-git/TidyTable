// One-question, one-answer prompt (build prompt §1: "reuse it everywhere a module
// needs to ask something"). Plain language, no jargon. The caller supplies the
// question and a short list of options; picking one calls onAnswer(value).
export default function ClarifyBox({ question, options, onAnswer, onCancel, cancelLabel = "Not now" }) {
  return (
    <div className="clarify" role="group" aria-label="One quick question">
      <p className="clarify-q">{question}</p>
      <div className="clarify-opts">
        {options.map((o) => (
          <button key={o.value} type="button" className="btn clarify-opt" onClick={() => onAnswer(o.value)}>
            <strong>{o.label}</strong>
            {o.detail && <span className="dim"> — {o.detail}</span>}
          </button>
        ))}
      </div>
      {onCancel && (
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
      )}
    </div>
  );
}
