import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { OverviewSeries } from "../shared/types";
import { fmtMoney } from "./format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REALIZED = ["#178a50", "#2f5fe0", "#4a5aa8"];
const EXPECTED = ["#e08a2f", "#c0699b"];

// Cumulative revenue per close-month on a shared Jan–Dec axis: solid lines for
// realized (baseline year + won change deals), dashed for expected (open
// change deals). Overlaying years makes the retention gap visually obvious.
export default function RevenueChart({ series }: { series: OverviewSeries[] }) {
  const data = MONTHS.map((m, i) => {
    const point: Record<string, string | number> = { month: m };
    for (const s of series) point[s.label] = Math.round(s.values[i]);
    return point;
  });
  let r = 0;
  let e = 0;

  return (
    <div className="card">
      <h3>Revenue overlay — baseline vs change</h3>
      {series.length === 0 ? (
        <div className="empty">No dated revenue in this cohort.</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
            <Tooltip formatter={(v: number) => fmtMoney(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => (
              <Line
                key={s.label}
                dataKey={s.label}
                stroke={s.kind === "realized" ? REALIZED[r++ % REALIZED.length] : EXPECTED[e++ % EXPECTED.length]}
                strokeWidth={2.5}
                strokeDasharray={s.kind === "expected" ? "6 4" : undefined}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="muted small">Cumulative deal value by close month. Dashed = expected (open deals, by expected close date).</div>
    </div>
  );
}
