import { useMemo, useState } from "react";
import type { Deal } from "../shared/types";
import { fmtDate, fmtMoney } from "./format";
import { useSort } from "./useSort";

const COLS: Record<string, (d: Deal) => string | number | null> = {
  name: (d) => d.name.toLowerCase(),
  stage: (d) => d.stageLabel.toLowerCase(),
  amount: (d) => d.amount,
  products: (d) => d.products.length,
  close: (d) => (d.closeDate ? +new Date(d.closeDate) : null),
};

function stageBadge(d: Deal) {
  const cls = d.isWon ? "good" : d.isClosed ? "bad" : (d.probability ?? 0) >= 0.5 ? "" : "grey";
  return <span className={`badge ${cls}`}>{d.stageLabel}</span>;
}

// Expanded "deep dive" row: full status context + products + billing corroboration.
function DeepDive({ d }: { d: Deal }) {
  const pct = d.probability !== null ? Math.round(d.probability * 100) : null;
  return (
    <div className="deep">
      <div className="facts">
        <div className="fact"><div className="k">Pipeline</div><div className="v">{d.pipeline}</div></div>
        <div className="fact">
          <div className="k">Stage progress</div>
          <div className="v">{d.stageLabel}{pct !== null && ` · ${pct}%`}</div>
          <div className="stagebar">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`seg ${pct !== null && pct >= (i + 1) * 20 ? "done" : ""}`} />
            ))}
          </div>
        </div>
        <div className="fact"><div className="k">Deal type</div><div className="v">{d.dealType ?? "—"}</div></div>
        <div className="fact"><div className="k">Created</div><div className="v">{fmtDate(d.createDate)}</div></div>
        <div className="fact"><div className="k">MRR / ARR</div><div className="v">{fmtMoney(d.mrr)} / {fmtMoney(d.arr)}</div></div>
        <div className="fact">
          <div className="k">Billing corroboration</div>
          <div className="v">
            {d.matchedInvoice ? (
              <span className="badge good">
                {d.matchedInvoice.source === "stripe" ? "Stripe" : "QBO"} {d.matchedInvoice.number ?? "invoice"} · {fmtMoney(d.matchedInvoice.amount)}
              </span>
            ) : d.isWon ? (
              <span className="badge warn">⚠ no matching invoice</span>
            ) : (
              <span className="muted">n/a (not won)</span>
            )}
          </div>
        </div>
      </div>
      {d.products.length > 0 ? (
        <table className="data">
          <thead>
            <tr><th className="plain">Product</th><th className="plain num">Qty</th><th className="plain num">Amount</th><th className="plain">Billing</th></tr>
          </thead>
          <tbody>
            {d.products.map((p, i) => (
              <tr key={i}>
                <td>{p.name}</td>
                <td className="num">{p.quantity}</td>
                <td className="num">{fmtMoney(p.amount)}</td>
                <td>{p.recurring ?? "one-time"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted small">No line items on this deal.</div>
      )}
    </div>
  );
}

export default function DealsTable({ deals }: { deals: Deal[] }) {
  const [filter, setFilter] = useState<"all" | "open" | "won" | "lost">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      deals.filter((d) =>
        filter === "all" ? true : filter === "open" ? !d.isClosed : filter === "won" ? d.isWon : d.isClosed && !d.isWon,
      ),
    [deals, filter],
  );
  const { sorted, toggle, indicator } = useSort(filtered, COLS, "close");

  return (
    <div className="card">
      <h3>
        Deals <span className="count">({filtered.length})</span>
      </h3>
      <div className="filters">
        {(["all", "open", "won", "lost"] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? `All (${deals.length})` : f === "open" ? `Current (${deals.filter((d) => !d.isClosed).length})` : f === "won" ? `Won (${deals.filter((d) => d.isWon).length})` : `Lost (${deals.filter((d) => d.isClosed && !d.isWon).length})`}
          </button>
        ))}
      </div>
      {sorted.length === 0 ? (
        <div className="empty">No deals in this view.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th onClick={() => toggle("name")}>Deal{indicator("name")}</th>
              <th onClick={() => toggle("stage")}>Stage{indicator("stage")}</th>
              <th className="num" onClick={() => toggle("amount")}>Amount{indicator("amount")}</th>
              <th onClick={() => toggle("products")}>Products{indicator("products")}</th>
              <th onClick={() => toggle("close")}>Close date{indicator("close")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <FragmentRow key={d.id} d={d} expanded={expanded === d.id} onClick={() => setExpanded(expanded === d.id ? null : d.id)} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FragmentRow({ d, expanded, onClick }: { d: Deal; expanded: boolean; onClick: () => void }) {
  return (
    <>
      <tr className={`clickable ${expanded ? "expanded" : ""}`} onClick={onClick} title="Click for deal deep dive">
        <td>
          <b>{d.name}</b>
          {d.isWon && !d.matchedInvoice && d.amount ? <span className="badge warn" style={{ marginLeft: 6 }}>⚠ uncorroborated</span> : null}
        </td>
        <td>{stageBadge(d)}</td>
        <td className="num">{fmtMoney(d.amount)}</td>
        <td>{d.products.length ? d.products.map((p) => p.name).join(", ") : <span className="muted">—</span>}</td>
        <td>{fmtDate(d.closeDate)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
            <DeepDive d={d} />
          </td>
        </tr>
      )}
    </>
  );
}
