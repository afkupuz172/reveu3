import type { Ticket } from "../shared/types";
import { fmtDate } from "./format";
import { useSort } from "./useSort";

const COLS: Record<string, (t: Ticket) => string | number | null> = {
  subject: (t) => t.subject.toLowerCase(),
  status: (t) => t.stageLabel.toLowerCase(),
  priority: (t) => t.priority?.toLowerCase() ?? null,
  created: (t) => (t.createdAt ? +new Date(t.createdAt) : null),
  updated: (t) => (t.updatedAt ? +new Date(t.updatedAt) : null),
};

const prioBadge = (p: string | null) =>
  !p ? <span className="muted">—</span> : <span className={`badge ${p === "HIGH" ? "bad" : p === "MEDIUM" ? "warn" : "grey"}`}>{p.toLowerCase()}</span>;

export default function TicketsTable({ tickets, blockedMessage }: { tickets: Ticket[]; blockedMessage?: string }) {
  const { sorted, toggle, indicator } = useSort(tickets, COLS, "updated");
  const open = tickets.filter((t) => t.open).length;

  return (
    <div className="card">
      <h3>
        Support tickets <span className="count">({open} open / {tickets.length})</span>
      </h3>
      {blockedMessage ? (
        <div className="empty">🔒 Out of scope — {blockedMessage}</div>
      ) : tickets.length === 0 ? (
        <div className="empty">No tickets for this company.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th onClick={() => toggle("subject")}>Subject{indicator("subject")}</th>
              <th onClick={() => toggle("status")}>Status{indicator("status")}</th>
              <th onClick={() => toggle("priority")}>Priority{indicator("priority")}</th>
              <th onClick={() => toggle("created")}>Created{indicator("created")}</th>
              <th onClick={() => toggle("updated")}>Last activity{indicator("updated")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id}>
                <td><b>{t.subject}</b></td>
                <td><span className={`badge ${t.open ? "" : "grey"}`}>{t.stageLabel}</span></td>
                <td>{prioBadge(t.priority)}</td>
                <td>{fmtDate(t.createdAt)}</td>
                <td>{fmtDate(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
