import { useEffect, useState } from "react";
import type { CompanyHit, OverviewData, StageOption } from "../shared/types";
import { apiOverview, apiStages } from "./api";
import NrrChart from "./NrrChart";
import OverviewTable from "./OverviewTable";
import RevenueChart from "./RevenueChart";
import { fmtMoney, fmtPct, nrrColor } from "./format";

export default function OverviewPage({ onOpenCompany }: { onOpenCompany: (c: CompanyHit) => void }) {
  const [min, setMin] = useState("5000");
  const [max, setMax] = useState("50000");
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [stages, setStages] = useState<StageOption[]>([]);
  const [selectedStages, setSelectedStages] = useState<Set<string>>(new Set());
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiStages().then(setStages).catch(() => setStages([]));
  }, []);

  const toggleStage = (id: string) =>
    setSelectedStages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiOverview(Number(min), Number(max), Number(year), [...selectedStages]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const multiPipeline = new Set(stages.map((s) => s.pipeline)).size > 1;

  return (
    <>
      <div className="card">
        <h3>Deal cohort</h3>
        <p className="muted small" style={{ marginTop: -6 }}>
          Finds deals whose value and close date fall in this range, pairs each with its associated deal
          (earlier close = baseline, later = change), and analyzes net revenue retention across the pairs.
        </p>
        <div className="form-row">
          <div>
            <label>Min deal value ($)</label>
            <input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} />
          </div>
          <div>
            <label>Max deal value ($)</label>
            <input type="number" min={0} value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
          <div>
            <label>Close year</label>
            <input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <button className="btn" onClick={run} disabled={loading || Number(max) < Number(min)}>
            {loading ? "Analyzing…" : "Build overview"}
          </button>
        </div>
        {stages.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <label className="small muted" style={{ fontWeight: 600 }}>
              Pipeline status — deals found by the search must be in one of the selected statuses (none selected = all)
            </label>
            <div className="filters" style={{ flexWrap: "wrap", marginTop: 6 }}>
              {stages.map((s) => (
                <button
                  key={s.id}
                  className={`chip ${selectedStages.has(s.id) ? "active" : ""}`}
                  onClick={() => toggleStage(s.id)}
                  title={s.pipeline}
                >
                  {s.label}
                  {multiPipeline && <span className="muted small"> · {s.pipeline}</span>}
                </button>
              ))}
              {selectedStages.size > 0 && (
                <button className="chip" onClick={() => setSelectedStages(new Set())}>clear</button>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}
      {loading && (
        <div className="loading">
          <div className="spinner" /> Searching deals, pairing associations, computing NRR…
        </div>
      )}

      {data && !loading && (
        <>
          {data.scopeIssues.map((s, i) => (
            <div className="warning scope" key={i}>
              🔒 <b>{s.section}</b> out of scope — {s.message}
            </div>
          ))}
          {data.truncated && (
            <div className="warning">
              ⚠ The search matched more deals than the 1,000-deal scan cap — results below are a partial cohort.
              Narrow the value range, year or pipeline status to see everything.
            </div>
          )}
          <div className="card">
            <div className="hero">
              <div>
                <div className="biglabel">Cohort NRR</div>
                <div className="big" style={{ color: nrrColor(data.totals.nrr) }}>{fmtPct(data.totals.nrr)}</div>
              </div>
              <div>
                <div className="biglabel">Realized NRR</div>
                <div className="big" style={{ color: nrrColor(data.totals.realizedNrr) }}>{fmtPct(data.totals.realizedNrr)}</div>
              </div>
              <div>
                <div className="biglabel">Baseline value</div>
                <div className="big">{fmtMoney(data.totals.baselineValue)}</div>
              </div>
              <div>
                <div className="biglabel">Change value</div>
                <div className="big">{fmtMoney(data.totals.changeValue)}</div>
              </div>
              <div className="muted small" style={{ marginLeft: "auto", textAlign: "right" }}>
                {data.seedDealCount} deals matched ${Number(min).toLocaleString()}–${Number(max).toLocaleString()} closing {data.params.year}
                {data.params.stages.length > 0 && ` (${data.params.stages.length} status filter)`}
                <br />
                {data.totals.pairs} pairs · {data.unpairedCount} without an associated deal (excluded)
                <br />
                built with {data.apiCalls} HubSpot calls
              </div>
            </div>
          </div>

          {data.rows.length === 0 ? (
            <div className="empty card">
              No retention pairs in this cohort — deals were found but none has an associated deal with a closed-won baseline.
            </div>
          ) : (
            <>
              <div className="grid two">
                <RevenueChart series={data.revenueSeries} />
                <NrrChart rows={data.rows} />
              </div>
              <OverviewTable rows={data.rows} onOpenCompany={onOpenCompany} />
            </>
          )}
        </>
      )}
    </>
  );
}
