import { useEffect, useMemo, useState } from "react";
import type { CompanyHit, DashboardData, ResolveResult, ScopeIssue, SourceCandidate } from "../shared/types";
import { apiDashboard, apiResolve } from "./api";
import CompanySearch from "./CompanySearch";
import DealsTable from "./DealsTable";
import InvoicesCard from "./InvoicesCard";
import SourcesPanel from "./SourcesPanel";
import TicketsTable from "./TicketsTable";
import { fmtMoney } from "./format";

const key = (c: { source: string; id: string }) => `${c.source}:${c.id}`;

export default function DashboardPage({
  company,
  onSelectCompany,
}: {
  company: CompanyHit | null;
  onSelectCompany: (c: CompanyHit) => void;
}) {
  const [resolve, setResolve] = useState<ResolveResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [data, setData] = useState<DashboardData | null>(null);
  const [phase, setPhase] = useState<"idle" | "resolving" | "loading" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);

  // Company can change from the search box here OR from an Overview link.
  useEffect(() => {
    if (!company) return;
    let stale = false;
    setResolve(null);
    setData(null);
    setError(null);
    setPhase("resolving");
    apiResolve(company.id)
      .then((r) => {
        if (stale) return;
        setResolve(r);
        setSelected(new Set(r.candidates.filter((x) => x.autoSelected).map(key)));
      })
      .catch((e) => {
        if (stale) return;
        setError((e as Error).message);
        setPhase("idle");
      });
    return () => {
      stale = true;
    };
  }, [company?.id]);

  // Any change to the source selection reloads the dashboard (server caches
  // per selection combo, so toggling back and forth is instant).
  useEffect(() => {
    if (!company || !resolve) return;
    const stripe = [...selected].filter((k) => k.startsWith("stripe:")).map((k) => k.slice(7));
    const qbo = [...selected].filter((k) => k.startsWith("quickbooks:")).map((k) => k.slice(11));
    setPhase("loading");
    setError(null);
    let stale = false;
    apiDashboard(company.id, stripe, qbo)
      .then((d) => {
        if (stale) return;
        setData(d);
        setPhase("ready");
      })
      .catch((e) => {
        if (stale) return;
        setError((e as Error).message);
        setPhase("ready");
      });
    return () => {
      stale = true;
    };
  }, [company, resolve, selected]);

  const toggle = (c: SourceCandidate) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = key(c);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Attach candidate names to contributions (server only knows raw ids).
  const contributions = useMemo(() => {
    if (!data || !resolve) return [];
    return data.contributions.map((ct) => ({
      ...ct,
      name: resolve.candidates.find((c) => key(c) === key(ct))?.name ?? ct.id,
    }));
  }, [data, resolve]);

  const scopeIssues: ScopeIssue[] = [...(resolve?.scopeIssues ?? []), ...(data?.scopeIssues ?? [])];
  const blockedTickets = scopeIssues.find((i) => i.section === "tickets");

  return (
    <>
      <div className="card" style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <CompanySearch onSelect={onSelectCompany} label={company?.name} />
        {company && <span className="muted small">HubSpot company #{company.id}</span>}
      </div>

      {error && <div className="error-box">{error}</div>}
      {phase === "idle" && !company && <div className="empty card">Search for a company to build its dashboard.</div>}
      {phase === "resolving" && (
        <div className="loading">
          <div className="spinner" /> Matching billing sources for {company?.name}…
        </div>
      )}

      {resolve && (
        <>
          <div className="company-title">
            <h2>{resolve.company.name}</h2>
            {resolve.company.domain && <span className="muted">{resolve.company.domain}</span>}
            {data?.company.industry && <span className="badge grey">{data.company.industry}</span>}
            {data?.company.city && <span className="muted small">{data.company.city}</span>}
          </div>

          {scopeIssues.length > 0 && (
            <div className="warnings">
              {scopeIssues.map((s, i) => (
                <div className="warning scope" key={i}>
                  🔒 <b>{s.section}</b> out of scope — {s.message}
                </div>
              ))}
            </div>
          )}

          <SourcesPanel candidates={resolve.candidates} selected={selected} contributions={contributions} onToggle={toggle} />

          {phase === "loading" && (
            <div className="loading">
              <div className="spinner" /> Pulling deals, tickets and billing…
            </div>
          )}

          {data && phase === "ready" && (
            <>
              {data.warnings.length > 0 && (
                <div className="warnings">
                  {data.warnings.map((w, i) => (
                    <div className="warning" key={i}>⚠ {w}</div>
                  ))}
                </div>
              )}
              <div className="grid kpis">
                <Kpi label="Lifetime spend" value={fmtMoney(data.kpis.lifetimeSpend)} sub="collected across sources" />
                <Kpi label="MRR" value={fmtMoney(data.kpis.mrr)} sub="monthly recurring" />
                <Kpi label="ARR" value={fmtMoney(data.kpis.arr)} sub="MRR × 12" />
                <Kpi
                  label="Outstanding"
                  value={fmtMoney(data.kpis.outstanding)}
                  sub={`${data.kpis.outstandingCount} open · ${data.kpis.resolvedCount} resolved`}
                  tone={data.kpis.outstanding > 0 ? "warn" : undefined}
                />
                <Kpi label="Open pipeline" value={fmtMoney(data.kpis.openDealValue)} sub="unclosed deal value" />
                <Kpi label="Won to date" value={fmtMoney(data.kpis.wonDealValue)} sub="closed-won deal value" />
              </div>

              <DealsTable deals={data.deals} />
              <div className="grid two">
                <InvoicesCard invoices={data.invoices} />
                <TicketsTable tickets={data.tickets} blockedMessage={blockedTickets?.message} />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={tone === "warn" ? { color: "var(--warn)" } : undefined}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
