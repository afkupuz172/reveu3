// HubSpot client built around batch endpoints: reads and association lookups
// go through /batch (100 ids per call) so a dashboard or overview build costs
// a fixed handful of requests instead of N+1 per record.
import { env } from "./env.js";
import { HttpError, cached, chunk, mapPool, withRetry } from "./util.js";

const BASE = "https://api.hubapi.com";
// Search endpoints have their own (lower) rate limit; batch reads are generous.
const CONCURRENCY = 4;

let apiCallCount = 0;
export const hsCalls = () => apiCallCount;

export async function hsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return withRetry(async () => {
    apiCallCount++;
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${env.hubspotKey}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
    } catch (e) {
      throw new HttpError(0, `network: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const retryAfter = res.headers.get("Retry-After");
      const body = await res.text().catch(() => "");
      throw new HttpError(
        res.status,
        `HubSpot ${res.status} ${path}: ${body.slice(0, 300)}`,
        retryAfter ? Number(retryAfter) * 1000 : null,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }, `hubspot ${path}`);
}

type HsRecord = { id: string; properties: Record<string, string | null> };

export async function searchCompanies(q: string): Promise<HsRecord[]> {
  const query = q.trim();
  return cached(`hs:cosearch:${query.toLowerCase()}`, 30_000, async () => {
    // With a query, let HubSpot rank by relevance. Without one, show recently
    // active companies — sorting by name floats production's blank-named
    // auto-created companies to the top of the dropdown.
    const body = query
      ? { query, limit: 10, properties: ["name", "domain"] }
      : {
          limit: 10,
          properties: ["name", "domain"],
          sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
        };
    const res = await hsFetch<{ results: HsRecord[] }>("/crm/v3/objects/companies/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.results;
  });
}

// Production portals are full of auto-created companies with no name (just a
// domain). Fall back name → domain → id for anything user-facing.
export function companyDisplayName(props: Record<string, string | null>, id: string): string {
  return props.name || props.domain || `Company #${id}`;
}

export async function getCompany(id: string): Promise<HsRecord> {
  const props = "name,domain,industry,city,createdate";
  return hsFetch<HsRecord>(`/crm/v3/objects/companies/${id}?properties=${props}`);
}

// Single-object association listing (used for one company's deals/tickets/contacts).
export async function assocList(fromType: string, fromId: string, toType: string): Promise<string[]> {
  const res = await hsFetch<{ results: { toObjectId: number | string }[] }>(
    `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}?limit=500`,
  );
  return res.results.map((r) => String(r.toObjectId));
}

// Batch association read: one call per 100 source ids, returns fromId → toIds.
export async function assocBatch(
  fromType: string,
  toType: string,
  ids: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!ids.length) return map;
  const pages = await mapPool(chunk(ids, 100), CONCURRENCY, (batch) =>
    hsFetch<{ results: { from: { id: string }; to: { toObjectId: number | string }[] }[] }>(
      `/crm/v4/associations/${fromType}/${toType}/batch/read`,
      { method: "POST", body: JSON.stringify({ inputs: batch.map((id) => ({ id })) }) },
    ),
  );
  for (const page of pages)
    for (const r of page.results)
      map.set(String(r.from.id), r.to.map((t) => String(t.toObjectId)));
  return map;
}

// Batch property read: one call per 100 ids, returns id → properties.
export async function batchRead(
  type: string,
  ids: string[],
  properties: string[],
): Promise<Map<string, Record<string, string | null>>> {
  const map = new Map<string, Record<string, string | null>>();
  const unique = [...new Set(ids)];
  if (!unique.length) return map;
  const pages = await mapPool(chunk(unique, 100), CONCURRENCY, (batch) =>
    hsFetch<{ results: HsRecord[] }>(`/crm/v3/objects/${type}/batch/read`, {
      method: "POST",
      body: JSON.stringify({ properties, inputs: batch.map((id) => ({ id })) }),
    }),
  );
  for (const page of pages) for (const r of page.results) map.set(r.id, r.properties);
  return map;
}

export interface StageInfo {
  label: string;
  pipelineLabel: string;
  probability: number | null;
  isClosed: boolean;
  isWon: boolean;
}

// Pipeline metadata changes rarely — cache 10 minutes and share across requests.
export async function getStageMap(objectType: "deals" | "tickets"): Promise<Map<string, StageInfo>> {
  return cached(`hs:stages:${objectType}`, 600_000, async () => {
    const res = await hsFetch<{
      results: {
        label: string;
        stages: { id: string; label: string; metadata: { probability?: string; isClosed?: string; ticketState?: string } }[];
      }[];
    }>(`/crm/v3/pipelines/${objectType}`);
    const map = new Map<string, StageInfo>();
    for (const p of res.results)
      for (const s of p.stages) {
        const prob = s.metadata.probability !== undefined ? Number(s.metadata.probability) : null;
        map.set(s.id, {
          label: s.label,
          pipelineLabel: p.label,
          probability: prob,
          isClosed:
            s.metadata.isClosed === "true" || s.metadata.ticketState === "CLOSED" || prob === 1 || prob === 0,
          isWon: prob === 1,
        });
      }
    return map;
  });
}

// Paged deal search. Search API caps limit at 100 per page; we cap the total
// scan at `maxResults` and report truncation to the caller.
export async function searchDeals(
  filters: { propertyName: string; operator: string; value?: string; highValue?: string; values?: string[] }[],
  properties: string[],
  maxResults = 1000,
): Promise<{ results: HsRecord[]; total: number }> {
  const results: HsRecord[] = [];
  let after: string | undefined;
  let total = 0;
  do {
    const res = await hsFetch<{ total: number; results: HsRecord[]; paging?: { next?: { after: string } } }>(
      "/crm/v3/objects/deals/search",
      {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters }],
          properties,
          limit: 100,
          sorts: [{ propertyName: "closedate", direction: "ASCENDING" }],
          ...(after ? { after } : {}),
        }),
      },
    );
    total = res.total;
    results.push(...res.results);
    after = res.paging?.next?.after;
  } while (after && results.length < maxResults);
  return { results, total };
}

// Distinct deal stages across all pipelines, for the Overview's status filter.
export async function listStageOptions(): Promise<{ id: string; label: string; pipeline: string }[]> {
  const map = await getStageMap("deals");
  return [...map.entries()].map(([id, s]) => ({ id, label: s.label, pipeline: s.pipelineLabel }));
}

export const DEAL_PROPS = [
  "dealname",
  "amount",
  "closedate",
  "createdate",
  "dealstage",
  "pipeline",
  "dealtype",
  "hs_mrr",
  "hs_arr",
  "hs_num_of_associated_line_items",
  "hs_primary_associated_company",
  "hs_is_closed",
  "hs_is_closed_won",
  "hs_deal_stage_probability",
];
