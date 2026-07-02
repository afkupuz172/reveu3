import { useState } from "react";
import type { Invoice } from "../shared/types";
import { fmtDate, fmtMoney } from "./format";
import { useSort } from "./useSort";

const COLS: Record<string, (i: Invoice) => string | number | null> = {
  number: (i) => i.number ?? i.id,
  source: (i) => i.source,
  date: (i) => (i.date ? +new Date(i.date) : null),
  due: (i) => (i.dueDate ? +new Date(i.dueDate) : null),
  amount: (i) => i.amount,
  balance: (i) => i.balance,
  status: (i) => i.status,
};

const statusBadge = (s: Invoice["status"]) => (
  <span className={`badge ${s === "paid" ? "good" : s === "overdue" ? "bad" : s === "open" ? "warn" : "grey"}`}>{s}</span>
);

export default function InvoicesCard({ invoices }: { invoices: Invoice[] }) {
  const [view, setView] = useState<"outstanding" | "resolved" | "all">("outstanding");
  const visible = invoices.filter((i) => {
    if (view === "all") return true;
    const out = i.status === "open" || i.status === "overdue";
    return view === "outstanding" ? out : i.status === "paid";
  });
  const { sorted, toggle, indicator } = useSort(visible, COLS, "date");
  const outstanding = invoices.filter((i) => i.status === "open" || i.status === "overdue");

  return (
    <div className="card">
      <h3>Invoices</h3>
      <div className="filters">
        <button className={`chip ${view === "outstanding" ? "active" : ""}`} onClick={() => setView("outstanding")}>
          Outstanding ({outstanding.length})
        </button>
        <button className={`chip ${view === "resolved" ? "active" : ""}`} onClick={() => setView("resolved")}>
          Resolved ({invoices.filter((i) => i.status === "paid").length})
        </button>
        <button className={`chip ${view === "all" ? "active" : ""}`} onClick={() => setView("all")}>
          All ({invoices.length})
        </button>
      </div>
      {sorted.length === 0 ? (
        <div className="empty">No {view === "all" ? "" : view} invoices from the selected sources.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th onClick={() => toggle("number")}>Invoice{indicator("number")}</th>
              <th onClick={() => toggle("source")}>Source{indicator("source")}</th>
              <th onClick={() => toggle("date")}>Date{indicator("date")}</th>
              <th onClick={() => toggle("due")}>Due{indicator("due")}</th>
              <th className="num" onClick={() => toggle("amount")}>Amount{indicator("amount")}</th>
              <th className="num" onClick={() => toggle("balance")}>Balance{indicator("balance")}</th>
              <th onClick={() => toggle("status")}>Status{indicator("status")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((i) => (
              <tr key={`${i.source}:${i.id}`} style={i.duplicateOf ? { opacity: 0.5 } : undefined}>
                <td>
                  <b>{i.number ?? i.id.slice(0, 12)}</b>
                  {i.duplicateOf && <span className="badge grey" style={{ marginLeft: 6 }} title={`Duplicate of ${i.duplicateOf}; excluded from totals`}>dup</span>}
                  {i.memo && <div className="muted small">{i.memo}</div>}
                </td>
                <td><span className={`badge ${i.source === "stripe" ? "stripe" : "qbo"}`}>{i.source === "stripe" ? "Stripe" : "QuickBooks"}</span></td>
                <td>{fmtDate(i.date)}</td>
                <td>{fmtDate(i.dueDate)}</td>
                <td className="num">{fmtMoney(i.amount, 2)}</td>
                <td className="num">{i.balance > 0 ? <b style={{ color: "var(--bad)" }}>{fmtMoney(i.balance, 2)}</b> : "—"}</td>
                <td>{statusBadge(i.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
