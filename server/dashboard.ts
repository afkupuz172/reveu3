// Assembles the per-company dashboard. HubSpot cost is fixed and batched:
// company read + 3 association lists + batched deal/ticket/contact/line-item
// reads (+cached pipeline maps) ≈ 9-10 calls regardless of record counts.
import type {
  DashboardData, Deal, Invoice, Product, ResolveResult, ScopeIssue, SourceCandidate, SourceContribution, Ticket,
} from "../shared/types.js";
import {
  DEAL_PROPS, assocBatch, assocList, batchRead, getCompany, getStageMap, searchCompanies,
} from "./hubspot.js";
import { AUTO_SELECT, SHOW_THRESHOLD, scoreCandidate, toCandidate, type CompanyIdentity } from "./match.js";
import { hasStripe, stripeBilling, stripeCandidatePool } from "./stripe.js";
import { qboBilling, qboConfigured, qboConnected, qboCustomers } from "./qbo.js";
import { cached, num, scoped } from "./util.js";

export function sourceStatus() {
  return {
    hubspot: true,
    stripe: hasStripe(),
    quickbooks: qboConnected() ? ("connected" as const) : qboConfigured() ? ("configured" as const) : ("off" as const),
  };
}

async function companyIdentity(
  companyId: string,
  issues: ScopeIssue[] = [],
): Promise<{ identity: CompanyIdentity; company: ResolveResult["company"] }> {
  const rec = await getCompany(companyId);
  // Contacts only sharpen fuzzy matching — without the scope, matching still
  // works on company name + domain.
  const contacts = await scoped("contacts", new Map<string, Record<string, string | null>>(), issues, async () => {
    const contactIds = await assocList("companies", companyId, "contacts");
    return batchRead("contacts", contactIds.slice(0, 50), ["email"]);
  });
  const contactDomains = [
    ...new Set(
      [...contacts.values()]
        .map((p) => p.email?.split("@")[1]?.toLowerCase())
        .filter((d): d is string => Boolean(d)),
    ),
  ];
  const name = rec.properties.name || "(unnamed)";
  const domain = rec.properties.domain || null;
  return {
    identity: { name, domain, contactDomains },
    company: { id: companyId, name, domain },
  };
}

// Search bar backend + fuzzy source resolution for the selected company.
export async function resolveCompany(companyId: string): Promise<ResolveResult> {
  const scopeIssues: ScopeIssue[] = [];
  const { identity, company } = await companyIdentity(companyId, scopeIssues);
  const candidates: SourceCandidate[] = [];

  if (hasStripe()) {
    // A rejected/underprivileged Stripe key shouldn't kill the CRM view.
    const pool = await stripeCandidatePool(identity.name, identity.domain).catch((e) => {
      scopeIssues.push({ section: "Stripe customers", message: `Stripe rejected the request: ${(e as Error).message}` });
      return [];
    });
    for (const c of pool) {
      const scored = scoreCandidate(identity, { name: c.name, email: c.email, extraText: c.description });
      if (scored.score >= SHOW_THRESHOLD)
        candidates.push(
          toCandidate("stripe", c.id, c.name, c.email, `created ${new Date(c.created * 1000).getFullYear()}`, scored),
        );
    }
  }

  if (qboConnected()) {
    const pool = await qboCustomers().catch((e) => {
      scopeIssues.push({ section: "QuickBooks customers", message: `QuickBooks rejected the request: ${(e as Error).message}` });
      return [];
    });
    for (const c of pool) {
      const scored = scoreCandidate(identity, {
        name: c.DisplayName || c.CompanyName || null,
        email: c.PrimaryEmailAddr?.Address ?? null,
        extraText: c.WebAddr?.URI ?? null,
      });
      if (scored.score >= SHOW_THRESHOLD)
        candidates.push(
          toCandidate("quickbooks", c.Id, c.DisplayName || c.CompanyName || null, c.PrimaryEmailAddr?.Address ?? null,
            c.Balance ? `balance $${c.Balance}` : null, scored),
        );
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  // Auto-select only the single best candidate per source; runners-up (stale
  // duplicates, trial accounts) stay visible but unchecked.
  const bestPerSource = new Set<string>();
  for (const c of candidates) {
    if (c.autoSelected && !bestPerSource.has(c.source)) bestPerSource.add(c.source);
    else c.autoSelected = false;
  }
  return { company, candidates, sources: sourceStatus(), scopeIssues };
}

async function fetchDeals(companyId: string, issues: ScopeIssue[]): Promise<Deal[]> {
  const dealIds = await assocList("companies", companyId, "deals");
  if (!dealIds.length) return [];
  const [props, stages] = await Promise.all([
    batchRead("deals", dealIds, DEAL_PROPS),
    getStageMap("deals"),
  ]);
  // Products are an enrichment — deals render without them if the token
  // can't read line items.
  const { lineItemMap, lineItems } = await scoped(
    "line items",
    { lineItemMap: new Map<string, string[]>(), lineItems: new Map<string, Record<string, string | null>>() },
    issues,
    async () => {
      const lineItemMap = await assocBatch("deals", "line_items", dealIds);
      const allLineItemIds = [...lineItemMap.values()].flat();
      const lineItems = await batchRead("line_items", allLineItemIds, [
        "name", "quantity", "price", "amount", "recurringbillingfrequency",
      ]);
      return { lineItemMap, lineItems };
    },
  );

  return dealIds
    .filter((id) => props.has(id))
    .map((id) => {
      const p = props.get(id)!;
      const stage = stages.get(p.dealstage || "");
      const products: Product[] = (lineItemMap.get(id) ?? [])
        .map((liId) => lineItems.get(liId))
        .filter((li): li is NonNullable<typeof li> => Boolean(li))
        .map((li) => ({
          name: li.name || "(product)",
          quantity: num(li.quantity) ?? 1,
          amount: num(li.amount) ?? (num(li.price) ?? 0) * (num(li.quantity) ?? 1),
          recurring: li.recurringbillingfrequency || null,
        }));
      return {
        id,
        name: p.dealname || "(untitled deal)",
        amount: num(p.amount),
        stageId: p.dealstage || "",
        stageLabel: stage?.label || p.dealstage || "?",
        pipeline: stage?.pipelineLabel || p.pipeline || "?",
        probability: num(p.hs_deal_stage_probability) ?? stage?.probability ?? null,
        isClosed: p.hs_is_closed === "true" || Boolean(stage?.isClosed),
        isWon: p.hs_is_closed_won === "true" || Boolean(stage?.isWon),
        closeDate: p.closedate || null,
        createDate: p.createdate || null,
        dealType: p.dealtype || null,
        mrr: num(p.hs_mrr),
        arr: num(p.hs_arr),
        products,
        matchedInvoice: null,
      };
    });
}

async function fetchTickets(companyId: string): Promise<Ticket[]> {
  const ids = await assocList("companies", companyId, "tickets");
  if (!ids.length) return [];
  const [props, stages] = await Promise.all([
    batchRead("tickets", ids, ["subject", "hs_pipeline_stage", "hs_ticket_priority", "createdate", "hs_lastmodifieddate"]),
    getStageMap("tickets"),
  ]);
  return ids
    .filter((id) => props.has(id))
    .map((id) => {
      const p = props.get(id)!;
      const stage = stages.get(p.hs_pipeline_stage || "");
      return {
        id,
        subject: p.subject || "(no subject)",
        stageLabel: stage?.label || p.hs_pipeline_stage || "?",
        pipeline: stage?.pipelineLabel || "?",
        priority: p.hs_ticket_priority || null,
        createdAt: p.createdate || null,
        updatedAt: p.hs_lastmodifieddate || null,
        open: !stage?.isClosed,
      };
    });
}

// Cross-source dedupe: the same real-world invoice often lives in both Stripe
// and QBO. Same doc number, or same amount ±2% within 7 days ⇒ QBO copy is
// marked duplicateOf and excluded from totals (Stripe wins as system of record
// for card payments); it stays visible so the user can see the overlap.
function markDuplicates(invoices: Invoice[]): void {
  const stripeInv = invoices.filter((i) => i.source === "stripe");
  for (const q of invoices) {
    if (q.source !== "quickbooks") continue;
    const dup = stripeInv.find((s) => {
      if (q.number && s.number && q.number === s.number) return true;
      if (!q.date || !s.date || q.amount <= 0) return false;
      const days = Math.abs(+new Date(q.date) - +new Date(s.date)) / 86_400_000;
      return days <= 7 && Math.abs(q.amount - s.amount) / q.amount <= 0.02;
    });
    if (dup) q.duplicateOf = `${dup.source}:${dup.number ?? dup.id}`;
  }
}

// Fuzzy deal↔invoice corroboration: a closed-won deal "has" an invoice if some
// non-duplicate invoice matches its amount within 2% (or a monthly 1/12 slice)
// dated within 120 days of close.
function matchDealInvoices(deals: Deal[], invoices: Invoice[]): void {
  const pool = invoices.filter((i) => !i.duplicateOf && i.status !== "void" && i.status !== "draft" && i.date);
  for (const deal of deals) {
    if (!deal.isWon || !deal.amount || !deal.closeDate) continue;
    const close = +new Date(deal.closeDate);
    let best: { inv: Invoice; dist: number } | null = null;
    for (const inv of pool) {
      const rel = (target: number) => Math.abs(inv.amount - target) / target;
      if (Math.min(rel(deal.amount), rel(deal.amount / 12)) > 0.02) continue;
      const days = Math.abs(+new Date(inv.date!) - close) / 86_400_000;
      if (days > 120) continue;
      if (!best || days < best.dist) best = { inv, dist: days };
    }
    if (best)
      deal.matchedInvoice = {
        source: best.inv.source,
        number: best.inv.number,
        amount: best.inv.amount,
        date: best.inv.date,
      };
  }
}

export async function buildDashboard(
  companyId: string,
  stripeIds: string[],
  qboIds: string[],
): Promise<DashboardData> {
  const key = `dash:${companyId}:${stripeIds.join(",")}:${qboIds.join(",")}`;
  return cached(key, 60_000, async () => {
    const warnings: string[] = [];
    const scopeIssues: ScopeIssue[] = [];
    // Each block degrades independently: a token that can't read tickets (or
    // deals, line items, contacts) still produces the rest of the dashboard,
    // with the gap reported in scopeIssues.
    const [{ identity, company }, deals, tickets, stripeData, qboData] = await Promise.all([
      companyIdentity(companyId, scopeIssues),
      scoped("deals", [] as Deal[], scopeIssues, () => fetchDeals(companyId, scopeIssues)),
      scoped("tickets", [] as Ticket[], scopeIssues, () => fetchTickets(companyId)),
      hasStripe() && stripeIds.length
        ? stripeBilling(stripeIds).catch((e) => {
            scopeIssues.push({ section: "Stripe billing", message: `Stripe rejected the request: ${(e as Error).message}` });
            return { invoices: [], mrr: 0, subscriptions: [] };
          })
        : Promise.resolve({ invoices: [], mrr: 0, subscriptions: [] }),
      qboConnected() && qboIds.length
        ? qboBilling(qboIds).catch((e) => {
            scopeIssues.push({ section: "QuickBooks billing", message: `QuickBooks rejected the request: ${(e as Error).message}` });
            return { invoices: [] };
          })
        : Promise.resolve({ invoices: [] }),
    ]);
    const companyRec = await getCompany(companyId);

    const invoices = [...stripeData.invoices, ...qboData.invoices].sort(
      (a, b) => +new Date(b.date ?? 0) - +new Date(a.date ?? 0),
    );
    markDuplicates(invoices);
    matchDealInvoices(deals, invoices);

    const countable = invoices.filter((i) => !i.duplicateOf && i.status !== "void" && i.status !== "draft");
    const outstanding = countable.filter((i) => i.status === "open" || i.status === "overdue");
    const resolved = countable.filter((i) => i.status === "paid");
    const lifetimeSpend = countable.reduce((s, i) => s + i.amountPaid, 0);
    const outstandingTotal = outstanding.reduce((s, i) => s + i.balance, 0);

    // MRR: Stripe subscriptions are authoritative when present; otherwise fall
    // back to HubSpot's recurring-revenue rollup on open+won deals.
    const hubspotMrr = deals.filter((d) => !d.isClosed || d.isWon).reduce((s, d) => s + (d.mrr ?? 0), 0);
    const mrr = stripeData.mrr > 0 ? stripeData.mrr : hubspotMrr;
    if (stripeData.mrr === 0 && hubspotMrr > 0)
      warnings.push("MRR derived from HubSpot recurring line items (no active Stripe subscriptions found).");

    const contributions: SourceContribution[] = [];
    for (const [source, ids] of [["stripe", stripeIds], ["quickbooks", qboIds]] as const) {
      for (const id of ids) {
        const mine = countable.filter((i) => i.source === source && i.sourceCustomerId === id);
        contributions.push({
          source,
          id,
          name: id,
          lifetime: mine.reduce((s, i) => s + i.amountPaid, 0),
          outstanding: mine.filter((i) => i.status !== "paid").reduce((s, i) => s + i.balance, 0),
          invoiceCount: mine.length,
          mrr: source === "stripe" ? stripeData.mrr : 0,
        });
      }
    }

    const dupCount = invoices.filter((i) => i.duplicateOf).length;
    if (dupCount) warnings.push(`${dupCount} invoice(s) appear in both Stripe and QuickBooks — counted once in totals.`);
    const unmatchedWon = deals.filter((d) => d.isWon && d.amount && !d.matchedInvoice).length;
    if (unmatchedWon && (stripeIds.length || qboIds.length))
      warnings.push(`${unmatchedWon} closed-won deal(s) have no corroborating invoice in the selected billing sources.`);

    return {
      company: {
        id: companyId,
        name: identity.name,
        domain: identity.domain,
        industry: companyRec.properties.industry || null,
        city: companyRec.properties.city || null,
        createdAt: companyRec.properties.createdate || null,
      },
      kpis: {
        lifetimeSpend,
        mrr,
        arr: mrr * 12,
        outstanding: outstandingTotal,
        outstandingCount: outstanding.length,
        resolvedCount: resolved.length,
        openDealValue: deals.filter((d) => !d.isClosed).reduce((s, d) => s + (d.amount ?? 0), 0),
        wonDealValue: deals.filter((d) => d.isWon).reduce((s, d) => s + (d.amount ?? 0), 0),
      },
      deals: deals.sort((a, b) => +new Date(b.closeDate ?? b.createDate ?? 0) - +new Date(a.closeDate ?? a.createDate ?? 0)),
      tickets: tickets.sort((a, b) => +new Date(b.updatedAt ?? 0) - +new Date(a.updatedAt ?? 0)),
      invoices,
      contributions,
      warnings,
      scopeIssues,
    };
  });
}

export { searchCompanies, AUTO_SELECT };
