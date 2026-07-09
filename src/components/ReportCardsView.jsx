import { maxOf } from "../logic/charts/aggregate.js";

// Renders report cards (build prompt §7/§11): one card per person, the subject's
// bar in the accent color and every peer bar gray. It is handed the already-coded
// report-card data — it never sees names.
export default function ReportCardsView({ reportCards }) {
  if (!reportCards || reportCards.cards.length === 0) return null;
  const { cards, metricLabel } = reportCards;
  // P1-6: a spread (Math.max(1, ...manyValues)) blows the call stack on a
  // large dataset (many cards × bars). A reduce loop has no such limit.
  const max = maxOf(cards.flatMap((c) => c.bars.map((b) => b.value)), 1);

  return (
    <div className="report-cards">
      <p className="section-intro">
        One card per person, measured by {metricLabel}. Each card highlights that person and
        shows everyone else for comparison, using codes only — no names appear here. Hand each
        person their own card; the code list stays with you.
      </p>
      {cards.map((card) => (
        <div key={`${card.group || ""}-${card.subject}`} className="report-card">
          <div className="report-card-head">
            <span className="report-card-subject">{card.subject}</span>
            {card.group && <span className="dim"> · {card.group}</span>}
            {card.smallCell && (
              <span className="report-card-warn">small group — may be identifiable</span>
            )}
          </div>
          <div className="report-bars">
            {card.bars.map((b) => (
              <div key={b.label} className="report-bar-row">
                <span className="report-bar-label">{b.label}</span>
                <span className="report-bar-track">
                  <span
                    className={b.isSubject ? "report-bar report-bar-subject" : "report-bar"}
                    style={{ width: `${Math.round((b.value / max) * 100)}%` }}
                  />
                </span>
                <span className="report-bar-value">{b.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
