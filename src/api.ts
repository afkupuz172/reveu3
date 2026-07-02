import type { CompanyHit, DashboardData, OverviewData, Product, ResolveResult, SourceStatus, StageOption } from "../shared/types";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `${res.status}`);
  }
  return res.json();
}

export const apiStatus = () => get<SourceStatus>("/api/status");
export const apiCompanies = (q: string) => get<CompanyHit[]>(`/api/companies?q=${encodeURIComponent(q)}`);
export const apiResolve = (id: string) => get<ResolveResult>(`/api/company/${id}/resolve`);
export const apiDashboard = (id: string, stripe: string[], qbo: string[]) =>
  get<DashboardData>(`/api/company/${id}/dashboard?stripe=${stripe.join(",")}&qbo=${qbo.join(",")}`);
export const apiOverview = (min: number, max: number, year: number, stages: string[]) =>
  get<OverviewData>(`/api/overview?min=${min}&max=${max}&year=${year}&stages=${stages.map(encodeURIComponent).join(",")}`);
export const apiStages = () => get<StageOption[]>("/api/deal-stages");
export const apiLineItems = (dealId: string) => get<Product[]>(`/api/deal/${dealId}/line-items`);
