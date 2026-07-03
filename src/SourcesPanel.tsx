import type { ReactNode } from "react";
import type { SourceCandidate, SourceContribution, SourceStatus } from "../shared/types";
import { fmtMoney } from "./format";

// The "where is this data coming from" view: every fuzzy-matched Stripe/QBO
// customer with its match score, the reasons behind the score, a toggle for
// inclusion, and (once loaded) what each selected source contributed.
// Sources that aren't configured/connected are stated as such — "no customers
// matched" must only ever mean a search actually ran.
export default function SourcesPanel({
  candidates,
  selected,
  contributions,
  sources,
  onToggle,
}: {
  candidates: SourceCandidate[];
  selected: Set<string>;
  contributions: SourceContribution[];
  sources: SourceStatus;
  onToggle: (cand: SourceCandidate) => void;
}) {
  const key = (c: { source: string; id: string }) => `${c.source}:${c.id}`;
  const contribFor = (c: SourceCandidate) => contributions.find((x) => key(x) === key(c));
  const scoreColor = (s: number) => (s >= 55 ? "var(--good)" : s >= 35 ? "var(--warn)" : "var(--muted)");

  const inactive: { label: string; cls: string; note: ReactNode }[] = [];
  if (!sources.stripe)
    inactive.push({ label: "Stripe", cls: "stripe", note: "not configured — set STRIPE_KEY in .env on this server to search Stripe customers" });
  if (sources.quickbooks !== "connected")
    inactive.push({
      label: "QuickBooks",
      cls: "qbo",
      note:
        sources.quickbooks === "configured" ? (
          <>
            not connected — <a href="/api/qbo/connect">connect QuickBooks</a> to search its customers
          </>
        ) : (
          "not configured — set QUICKBOOKS_CLIENT_ID / SECRET in .env on this server"
        ),
    });
  const anyActive = sources.stripe || sources.quickbooks === "connected";

  return (
    <div className="card">
      <h3>Billing data sources</h3>
      {inactive.map((s) => (
        <div className="source-row inactive" key={s.label}>
          <span className={`badge ${s.cls}`}>{s.label}</span>
          <div className="who muted">{s.note}</div>
        </div>
      ))}
      {candidates.length === 0 && anyActive && (
        <div className="empty">
          No {sources.stripe ? "Stripe" : ""}
          {sources.stripe && sources.quickbooks === "connected" ? " or " : ""}
          {sources.quickbooks === "connected" ? "QuickBooks" : ""} customers matched this company.
        </div>
      )}
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
