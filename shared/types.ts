// Shared API contract between server and frontend. Everything money is in
// dollars (Stripe cents are converted server-side) so the UI never converts.

export interface SourceStatus {
  hubspot: boolean;
  stripe: boolean;
  quickbooks: "connected" | "configured" | "off";
}

export interface CompanyHit {
  id: string;
  name: string;
  domain: string | null;
}

export interface MatchReason {
  label: string;
  points: number;
}

// A Stripe customer or QuickBooks customer that fuzzy-matched the selected
// HubSpot company. `score` drives the visualization; `reasons` explain it.
export interface SourceCandidate {
  source: "stripe" | "quickbooks";
  id: string;
  name: string;
  email: string | null;
  score: number;
  reasons: MatchReason[];
  autoSelected: boolean;
  meta: string | null;
}

export interface ResolveResult {
  company: CompanyHit;
  candidates: SourceCandidate[];
  sources: SourceStatus;
  scopeIssues: ScopeIssue[];
}

export interface Product {
  name: string;
  quantity: number;
  amount: number;
  recurring: string | null;
}

export interface MatchedInvoiceRef {
  source: "stripe" | "quickbooks";
  number: string | null;
  amount: number;
  date: string | null;
}

export interface Deal {
  id: string;
  name: string;
  amount: number | null;
  stageId: string;
  stageLabel: string;
  pipeline: string;
  probability: number | null;
  isClosed: boolean;
  isWon: boolean;
  closeDate: string | null;
  createDate: string | null;
  dealType: string | null;
  mrr: number | null;
  arr: number | null;
  products: Product[];
  // Best billing-side corroboration found for a closed-won deal (fuzzy:
  // amount within tolerance, date near close). null = nothing matched.
  matchedInvoice: MatchedInvoiceRef | null;
}

export interface Ticket {
  id: string;
  subject: string;
  stageLabel: string;
  pipeline: string;
  priority: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  open: boolean;
}

export type InvoiceStatus = "paid" | "open" | "overdue" | "void" | "draft";

export interface Invoice {
  source: "stripe" | "quickbooks";
  sourceCustomerId: string;
  id: string;
  number: string | null;
  date: string | null;
  dueDate: string | null;
  amount: number;
  amountPaid: number;
  balance: number;
  status: InvoiceStatus;
  memo: string | null;
  // Set when the same invoice appears in both Stripe and QBO (same number, or
  // same amount ±2% within 7 days). Duplicates are excluded from KPI totals.
  duplicateOf: string | null;
}

// Per selected source: what it actually contributed to the dashboard totals.
export interface SourceContribution {
  source: "stripe" | "quickbooks";
  id: string;
  name: string;
  lifetime: number;
  outstanding: number;
  invoiceCount: number;
  mrr: number;
}

export interface DashboardData {
  company: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    city: string | null;
    createdAt: string | null;
  };
  kpis: {
    lifetimeSpend: number;
    mrr: number;
    arr: number;
    outstanding: number;
    outstandingCount: number;
    resolvedCount: number;
    openDealValue: number;
    wonDealValue: number;
  };
  deals: Deal[];
  tickets: Ticket[];
  invoices: Invoice[];
  contributions: SourceContribution[];
  warnings: string[];
  scopeIssues: ScopeIssue[];
}

// ---- Overview (deal-pair NRR) ----

export interface OverviewDeal {
  id: string;
  name: string;
  amount: number | null;
  closeDate: string | null;
  createDate: string | null;
  stageLabel: string;
  pipeline: string;
  dealType: string | null;
  mrr: number | null;
  arr: number | null;
  lineItemCount: number | null;
  isClosed: boolean;
  isWon: boolean;
  probability: number | null;
}

// One deduped pair: baseline = earlier close date, change = the later /
// future associated deal. NRR = change ÷ baseline, always amount-based
// (hs_mrr/hs_arr are displayed per deal but never drive the ratio).
export interface OverviewRow {
  baseline: OverviewDeal;
  change: OverviewDeal;
  companyId: string | null;
  companyName: string | null;
  nrr: number | null; // amount-based; 0 when the change deal was lost
  status: "realized" | "pending" | "churned";
}

export interface StageOption {
  id: string;
  label: string;
  pipeline: string;
}

// A data block the current token couldn't read (missing scope). The UI shows
// these instead of failing the whole page.
export interface ScopeIssue {
  section: string;
  message: string;
}

export interface OverviewSeries {
  label: string;
  kind: "realized" | "expected";
  values: number[]; // cumulative, indexed Jan..Dec
}

export interface OverviewData {
  params: { min: number; max: number; year: number; stages: string[] };
  rows: OverviewRow[];
  totals: {
    baselineValue: number;
    changeValue: number;
    nrr: number | null;
    realizedNrr: number | null; // pairs whose change deal already closed
    pairs: number;
    expansion: number;
    flat: number;
    contraction: number;
    churned: number;
    pending: number;
  };
  revenueSeries: OverviewSeries[];
  seedDealCount: number; // deals matched by the range/year search
  unpairedCount: number; // seeds with no associated deal (excluded)
  truncated: boolean; // search hit the scan cap; results are partial
  scopeIssues: ScopeIssue[];
  apiCalls: number; // HubSpot calls spent building this payload
}
