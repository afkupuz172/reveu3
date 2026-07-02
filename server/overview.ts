// Overview: value-range + year → deal-pair NRR. Built ENTIRELY from HubSpot
// deal properties in ~4 batched call groups so a wide scan stays cheap:
//   1. deal search (amount BETWEEN min..max AND closedate within year), paged
//   2. one batched deal→deal association read over the seed ids
//   3. one batched property read over seed ∪ associated deal ids
//   4. one batched company read for primary-company names (+cached stage map)
import type { OverviewData, OverviewDeal, OverviewRow, OverviewSeries, ScopeIssue } from "../shared/types.js";
import { DEAL_PROPS, assocBatch, assocList, batchRead, getStageMap, hsCalls, searchDeals } from "./hubspot.js";
import { cached, num, scoped } from "./util.js";

function toOverviewDeal(
  id: string,
  p: Record<string, string | null>,
  stages: Map<string, { label: string; pipelineLabel: string; probability: number | null; isClosed: boolean; isWon: boolean }>,
): OverviewDeal {
  const stage = stages.get(p.dealstage || "");
  return {
    id,
    name: p.dealname || "(untitled deal)",
    amount: num(p.amount),
    closeDate: p.closedate || null,
    createDate: p.createdate || null,
    stageLabel: stage?.label || p.dealstage || "?",
    pipeline: stage?.pipelineLabel || p.pipeline || "?",
    dealType: p.dealtype || null,
    mrr: num(p.hs_mrr),
    arr: num(p.hs_arr),
    lineItemCount: num(p.hs_num_of_associated_line_items),
    isClosed: p.hs_is_closed === "true" || Boolean(stage?.isClosed),
    isWon: p.hs_is_closed_won === "true" || Boolean(stage?.isWon),
    probability: num(p.hs_deal_stage_probability) ?? stage?.probability ?? null,
  };
}

const time = (d: OverviewDeal) => (d.closeDate ? +new Date(d.closeDate) : Infinity);

// Baseline = the deal that closed first; the other is the change/renewal.
// A pair only expresses retention when the baseline actually became revenue,
// so baselines that are closed-LOST are excluded (that pair is new business).
function makeRow(a: OverviewDeal, b: OverviewDeal, companyName: string | null): OverviewRow | null {
  const [baseline, change] = time(a) <= time(b) ? [a, b] : [b, a];
  if (!baseline.isWon || !baseline.amount) return null;

  // NRR is deliberately amount-based; hs_mrr/hs_arr ride along for display only.
  const changeAmount = change.isClosed && !change.isWon ? 0 : (change.amount ?? 0);
  const nrr = Math.round((changeAmount / baseline.amount) * 1000) / 10;

  return {
    baseline,
    change,
    companyId: null,
    companyName,
    nrr,
    status: change.isClosed ? (change.isWon ? "realized" : "churned") : "pending",
  };
}

// Cumulative monthly revenue lines, one series per (kind, year): baseline
// deals plot as realized in their close year; change deals plot as realized
// (won) or expected (open, by expected close date). Lost change deals plot
// nothing — that's the churn gap the chart is meant to show.
function buildSeries(rows: OverviewRow[]): OverviewSeries[] {
  const buckets = new Map<string, { kind: "realized" | "expected"; year: number; months: number[] }>();
  const add = (kind: "realized" | "expected", dateStr: string | null, amount: number | null) => {
    if (!dateStr || !amount) return;
    const d = new Date(dateStr);
    const key = `${kind}:${d.getUTCFullYear()}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { kind, year: d.getUTCFullYear(), months: new Array(12).fill(0) }));
    b.months[d.getUTCMonth()] += amount;
  };
  for (const r of rows) {
    add("realized", r.baseline.closeDate, r.baseline.amount);
    if (r.status === "realized") add("realized", r.change.closeDate, r.change.amount);
    else if (r.status === "pending") add("expected", r.change.closeDate, r.change.amount);
  }
  return [...buckets.values()]
    .sort((a, b) => a.year - b.year || (a.kind === "realized" ? -1 : 1))
    .map((b) => {
      const values: number[] = [];
      b.months.reduce((acc, v, i) => (values[i] = acc + v), 0);
      return { label: `${b.kind === "realized" ? "Realized" : "Expected"} ${b.year}`, kind: b.kind, values };
    });
}

export async function buildOverview(
  min: number,
  max: number,
  year: number,
  stages: string[] = [],
): Promise<OverviewData> {
  const stageKey = [...stages].sort().join("|");
  return cached(`overview:${min}:${max}:${year}:${stageKey}`, 120_000, async () => {
    const callsBefore = hsCalls();
    const scopeIssues: ScopeIssue[] = [];

    // The stage filter composes into the same single search call, so
    // narrowing by pipeline status costs nothing extra.
    const { results: seeds, total } = await searchDeals(
      [
        { propertyName: "amount", operator: "BETWEEN", value: String(min), highValue: String(max) },
        { propertyName: "closedate", operator: "BETWEEN", value: `${year}-01-01`, highValue: `${year}-12-31` },
        ...(stages.length ? [{ propertyName: "dealstage", operator: "IN", values: stages }] : []),
      ],
      ["dealname"],
    );
    const seedIds = seeds.map((s) => s.id);

    const pairMap = await assocBatch("deals", "deals", seedIds);
    // Dedupe: pair (a,b) and (b,a) collapse to one sorted key.
    const pairKeys = new Set<string>();
    for (const [from, tos] of pairMap)
      for (const to of tos) pairKeys.add([from, to].sort((x, y) => Number(x) - Number(y)).join(":"));
    const unpairedCount = seedIds.filter((id) => !(pairMap.get(id)?.length)).length;

    const allIds = [...new Set([...pairKeys].flatMap((k) => k.split(":")))];
    const [props, stageMap] = await Promise.all([batchRead("deals", allIds, DEAL_PROPS), getStageMap("deals")]);

    const companyIds = [...new Set(
      allIds.map((id) => props.get(id)?.hs_primary_associated_company).filter((v): v is string => Boolean(v)),
    )];
    // Company names are cosmetic — a token without company scope still gets
    // the full NRR analysis, with ids in place of names.
    const companies = await scoped("company names", new Map<string, Record<string, string | null>>(), scopeIssues, () =>
      batchRead("companies", companyIds, ["name"]),
    );

    const rows: OverviewRow[] = [];
    for (const key of pairKeys) {
      const [idA, idB] = key.split(":");
      const pA = props.get(idA);
      const pB = props.get(idB);
      if (!pA || !pB) continue;
      const a = toOverviewDeal(idA, pA, stageMap);
      const b = toOverviewDeal(idB, pB, stageMap);
      const companyId = pA.hs_primary_associated_company || pB.hs_primary_associated_company || null;
      const row = makeRow(a, b, companyId ? companies.get(companyId)?.name || companyId : null);
      if (row) {
        row.companyId = companyId;
        rows.push(row);
      }
    }
    rows.sort((a, b) => time(a.baseline) - time(b.baseline));

    const baselineValue = rows.reduce((s, r) => s + (r.baseline.amount ?? 0), 0);
    const changeValue = rows.reduce(
      (s, r) => s + (r.status === "churned" ? 0 : (r.change.amount ?? 0)),
      0,
    );
    const realized = rows.filter((r) => r.status !== "pending");
    const realizedBase = realized.reduce((s, r) => s + (r.baseline.amount ?? 0), 0);
    const realizedChange = realized.reduce((s, r) => s + (r.status === "churned" ? 0 : (r.change.amount ?? 0)), 0);

    return {
      params: { min, max, year, stages },
      rows,
      totals: {
        baselineValue,
        changeValue,
        nrr: baselineValue > 0 ? Math.round((changeValue / baselineValue) * 1000) / 10 : null,
        realizedNrr: realizedBase > 0 ? Math.round((realizedChange / realizedBase) * 1000) / 10 : null,
        pairs: rows.length,
        expansion: rows.filter((r) => (r.nrr ?? 0) > 100).length,
        flat: rows.filter((r) => r.nrr === 100).length,
        contraction: rows.filter((r) => r.nrr !== null && r.nrr > 0 && r.nrr < 100).length,
        churned: rows.filter((r) => r.status === "churned").length,
        pending: rows.filter((r) => r.status === "pending").length,
      },
      revenueSeries: buildSeries(rows),
      seedDealCount: seedIds.length,
      unpairedCount,
      truncated: total > seedIds.length,
      scopeIssues,
      apiCalls: hsCalls() - callsBefore,
    };
  });
}

// On-demand line items for one deal (Overview rows fetch these only when the
// user clicks "view line items" — never prefetched for the whole cohort).
export async function dealLineItems(dealId: string) {
  return cached(`li:${dealId}`, 300_000, async () => {
    const ids = await assocList("deals", dealId, "line_items");
    const props = await batchRead("line_items", ids, ["name", "quantity", "price", "amount", "recurringbillingfrequency"]);
    return ids
      .map((id) => props.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        name: p.name || "(product)",
        quantity: num(p.quantity) ?? 1,
        amount: num(p.amount) ?? (num(p.price) ?? 0) * (num(p.quantity) ?? 1),
        recurring: p.recurringbillingfrequency || null,
      }));
  });
}
