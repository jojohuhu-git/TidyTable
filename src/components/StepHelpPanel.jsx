// P2-4: one collapsed "How to use this step" pattern, reused on every step
// card. Generalizes Step 3's "What kinds of questions work without AI"
// expander (still Step 3's own, more detailed panel) into a lighter, shared
// shape: what it does (one sentence), what it can't do yet (the honest
// limits), and — where a step has real input to fill — a few clickable
// examples built from the user's own column names. `examples` is optional:
// a step with nothing safe to auto-run (Step 2 today) omits it rather than
// wiring a fake action.
export default function StepHelpPanel({ whatItDoes, cantDoYet, examples }) {
  return (
    <details className="step-help">
      <summary>How to use this step</summary>
      <p className="step-help-does">{whatItDoes}</p>
      {cantDoYet?.length > 0 && (
        <p className="step-help-cant">
          <strong>Can't do yet:</strong> {cantDoYet.join(" ")}
        </p>
      )}
      {examples?.length > 0 && (
        <div className="step-help-examples">
          <span className="step-help-examples-label">Try these:</span>
          {examples.map((ex) => (
            <button key={ex.label} type="button" className="example-chip" onClick={ex.onClick}>
              {ex.label}
            </button>
          ))}
        </div>
      )}
    </details>
  );
}
