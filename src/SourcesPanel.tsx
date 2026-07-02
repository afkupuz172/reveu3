import type { SourceCandidate, SourceContribution } from "../shared/types";
import { fmtMoney } from "./format";

// The "where is this data coming from" view: every fuzzy-matched Stripe/QBO
// customer with its match score, the reasons behind the score, a toggle for
// inclusion, and (once loaded) what each selected source contributed.
export default function SourcesPanel({
  candidates,
  selected,
  contributions,
  onToggle,
}: {
  candidates: SourceCandidate[];
  selected: Set<string>;
  contributions: SourceContribution[];
  onToggle: (cand: SourceCandidate) => void;
}) {
  const key = (c: { source: string; id: string }) => `${c.source}:${c.id}`;
  const contribFor = (c: SourceCandidate) => contributions.find((x) => key(x) === key(c));
  const scoreColor = (s: number) => (s >= 55 ? "var(--good)" : s >= 35 ? "var(--warn)" : "var(--muted)");

  return (
    <div className="card">
      <h3>Billing data sources</h3>
      {candidates.length === 0 && <div className="empty">No Stripe or QuickBooks customers matched this company.</div>}
      {candidates.map((c) => {
        const contrib = contribFor(c);
        const isOn = selected.has(key(c));
        return (
          <div className="source-row" key={key(c)}>
            <input type="checkbox" checked={isOn} onChange={() => onToggle(c)} title={isOn ? "Exclude from totals" : "Include in totals"} />
            <span className={`badge ${c.source === "stripe" ? "stripe" : "qbo"}`}>{c.source === "stripe" ? "Stripe" : "QuickBooks"}</span>
            <div className="who">
              <div className="name">
                {c.name} {c.meta && <span className="muted small">· {c.meta}</span>}
              </div>
              {c.email && <div className="email">{c.email}</div>}
              <div className="reasons">
                {c.reasons.map((r, i) => (
                  <span className="reason" key={i}>
                    {r.label} +{r.points}
                  </span>
                ))}
              </div>
            </div>
            <div title={`Match confidence ${c.score}/100`}>
              <div className="scorebar">
                <div style={{ width: `${c.score}%`, background: scoreColor(c.score) }} />
              </div>
              <div className="small muted" style={{ textAlign: "right" }}>{c.score}/100</div>
            </div>
            {isOn && contrib && (
              <div className="contrib">
                <b>{fmtMoney(contrib.lifetime)}</b> collected · {contrib.invoiceCount} inv
                {contrib.outstanding > 0 && (
                  <>
                    <br />
                    <span style={{ color: "var(--warn)" }}>{fmtMoney(contrib.outstanding)} outstanding</span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
