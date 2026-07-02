import { useEffect, useMemo, useState } from "react";
import type { CompanyHit, OverviewDeal, OverviewRow, Product } from "../shared/types";
import { apiLineItems } from "./api";
import { fmtDate, fmtMoney, fmtPct, nrrColor } from "./format";
import { useSort } from "./useSort";

const COLS: Record<string, (r: OverviewRow) => string | number | null> = {
  company: (r) => r.companyName?.toLowerCase() ?? null,
  baseline: (r) => r.baseline.name.toLowerCase(),
  baseAmount: (r) => r.baseline.amount,
  baseClose: (r) => (r.baseline.closeDate ? +new Date(r.baseline.closeDate) : null),
  baseItems: (r) => r.baseline.lineItemCount,
  change: (r) => r.change.name.toLowerCase(),
  changeAmount: (r) => (r.status === "churned" ? 0 : r.change.amount),
  changeClose: (r) => (r.change.closeDate ? +new Date(r.change.closeDate) : null),
  changeItems: (r) => r.change.lineItemCount,
  status: (r) => r.status,
  nrr: (r) => r.nrr,
};

const PAGE_SIZES = [25, 50, 100];

type ItemsState = Product[] | "loading" | { error: string };

function statusBadge(r: OverviewRow) {
  if (r.status === "realized") return <span className="badge good">{r.change.stageLabel}</span>;
  if (r.status === "churned") return <span className="badge bad">{r.change.stageLabel}</span>;
  const pct = r.change.probability !== null ? ` ${Math.round(r.change.probability * 100)}%` : "";
  return <span className="badge">{r.change.stageLabel}{pct}</span>;
}

// Deal cell shows the HubSpot-supplied recurring numbers (hs_mrr / hs_arr)
// for both sides of the pair; the NRR column stays amount-based.
function DealCell({ d }: { d: OverviewDeal }) {
  return (
    <>
      <b>{d.name}</b>
      <div className="muted small">{d.dealType ?? "—"}</div>
      <div className="small">
        MRR <b>{fmtMoney(d.mrr)}</b> · ARR <b>{fmtMoney(d.arr)}</b>
      </div>
    </>
  );
}

function ItemsCell({ deal, state, onLoad }: { deal: OverviewDeal; state: ItemsState | undefined; onLoad: () => void }) {
  const count = deal.lineItemCount;
  if (state === "loading") return <span className="muted small">loading…</span>;
  if (state && typeof state === "object" && "error" in state) return <span className="badge warn" title={state.error}>🔒 {state.error.includes("scope") ? "out of scope" : "failed"}</span>;
  if (Array.isArray(state))
    return state.length === 0 ? (
      <span className="muted small">no line items</span>
    ) : (
      <ul className="items-list">
        {state.map((p, i) => (
          <li key={i}>
            {p.name} <span className="muted">×{p.quantity} · {fmtMoney(p.amount)}{p.recurring ? ` · ${p.recurring}` : ""}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <>
      <span className="itemcount">{count ?? "—"}</span>
      {(count ?? 0) > 0 && (
        <button className="linklike small" onClick={onLoad}>
          view line items
        </button>
      )}
    </>
  );
}

export default function OverviewTable({
  rows,
  onOpenCompany,
}: {
  rows: OverviewRow[];
  onOpenCompany: (c: CompanyHit) => void;
}) {
  const { sorted, toggle, indicator } = useSort(rows, COLS, "nrr");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [items, setItems] = useState<Record<string, ItemsState>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (r) =>
        (r.companyName ?? "").toLowerCase().includes(q) ||
        r.baseline.name.toLowerCase().includes(q) ||
        r.change.name.toLowerCase().includes(q),
    );
  }, [sorted, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => setPage(0), [query, pageSize, rows]);
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const loadItems = (dealId: string) => {
    setItems((prev) => ({ ...prev, [dealId]: "loading" }));
    apiLineItems(dealId)
      .then((products) => setItems((prev) => ({ ...prev, [dealId]: products })))
      .catch((e) => setItems((prev) => ({ ...prev, [dealId]: { error: (e as Error).message } })));
  };

  return (
    <div className="card">
      <div className="table-toolbar">
        <h3>
          Deal pairs <span className="count">({filtered.length}{filtered.length !== rows.length ? ` of ${rows.length}` : ""})</span>
        </h3>
        <input
          className="table-filter"
          placeholder="Filter by company or deal name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
      </div>
      <table className="data pairs">
        <thead>
          <tr>
            <th onClick={() => toggle("company")}>Company{indicator("company")}</th>
            <th onClick={() => toggle("baseline")}>Original deal{indicator("baseline")}</th>
            <th className="num" onClick={() => toggle("baseAmount")}>Baseline ${indicator("baseAmount")}</th>
            <th onClick={() => toggle("baseClose")}>Closed{indicator("baseClose")}</th>
            <th onClick={() => toggle("baseItems")}>Items{indicator("baseItems")}</th>
            <th onClick={() => toggle("change")}>Associated deal{indicator("change")}</th>
            <th className="num" onClick={() => toggle("changeAmount")}>Change ${indicator("changeAmount")}</th>
            <th onClick={() => toggle("changeClose")}>Close{indicator("changeClose")}</th>
            <th onClick={() => toggle("changeItems")}>Items{indicator("changeItems")}</th>
            <th onClick={() => toggle("status")}>Status{indicator("status")}</th>
            <th className="num" onClick={() => toggle("nrr")}>NRR{indicator("nrr")}</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr key={`${r.baseline.id}:${r.change.id}`}>
              <td>
                {r.companyId ? (
                  <button
                    className="linklike"
                    title="Open in Dashboard"
                    onClick={() => onOpenCompany({ id: r.companyId!, name: r.companyName ?? `#${r.companyId}`, domain: null })}
                  >
                    {r.companyName ?? `#${r.companyId}`}
                  </button>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td><DealCell d={r.baseline} /></td>
              <td className="num">{fmtMoney(r.baseline.amount)}</td>
              <td>{fmtDate(r.baseline.closeDate)}</td>
              <td>
                <ItemsCell deal={r.baseline} state={items[r.baseline.id]} onLoad={() => loadItems(r.baseline.id)} />
              </td>
              <td><DealCell d={r.change} /></td>
              <td className="num">
                {r.status === "churned" ? <s className="muted">{fmtMoney(r.change.amount)}</s> : fmtMoney(r.change.amount)}
              </td>
              <td>{fmtDate(r.change.closeDate)}{r.status === "pending" && <div className="muted small">expected</div>}</td>
              <td>
                <ItemsCell deal={r.change} state={items[r.change.id]} onLoad={() => loadItems(r.change.id)} />
              </td>
              <td>{statusBadge(r)}</td>
              <td className="num">
                <b style={{ color: nrrColor(r.nrr) }}>{fmtPct(r.nrr)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pageCount > 1 && (
        <div className="pager">
          <button className="chip" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹ Prev</button>
          <span className="muted small">page {safePage + 1} of {pageCount}</span>
          <button className="chip" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
