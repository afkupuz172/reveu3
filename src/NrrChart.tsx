import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { OverviewRow } from "../shared/types";

// Aggregate NRR health: how many pairs are growing (>100%), stagnant (=100%)
// or declining (<100%, churn included). Counts stay readable at any cohort
// size, unlike one bar per pair.
export default function NrrChart({ rows }: { rows: OverviewRow[] }) {
  const bucket = (r: OverviewRow) => ((r.nrr ?? 0) > 100 ? "growth" : (r.nrr ?? 0) === 100 ? "stagnant" : "declining");
  const count = (b: string, pending: boolean) => rows.filter((r) => bucket(r) === b && (r.status === "pending") === pending).length;

  const data = [
    { name: "Growth", closed: count("growth", false), pending: count("growth", true), color: "#178a50" },
    { name: "Stagnant", closed: count("stagnant", false), pending: count("stagnant", true), color: "#4a5aa8" },
    { name: "Declining", closed: count("declining", false), pending: count("declining", true), color: "#c0392b" },
  ].map((d) => ({ ...d, total: d.closed + d.pending }));

  return (
    <div className="card">
      <h3>NRR health — deal pair counts</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 20, right: 12, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e3e8f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 13 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v: number, key: string) => [v, key === "closed" ? "Closed pairs" : "Pending (open renewal)"]}
          />
          <Bar dataKey="closed" stackId="a" radius={[0, 0, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Bar>
          <Bar dataKey="pending" stackId="a" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} fillOpacity={0.4} />
            ))}
            <LabelList dataKey="total" position="top" style={{ fontSize: 13, fontWeight: 700, fill: "#1a2433" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="muted small">
        Growth = NRR above 100% · Stagnant = exactly 100% · Declining = below 100% (churned renewals included).
        Lighter segments are pending pairs whose renewal hasn't closed yet.
      </div>
    </div>
  );
}
