import Stripe from "stripe";
import { env } from "./env.js";
import { cached, mapPool } from "./util.js";
import type { Invoice } from "../shared/types.js";

export const hasStripe = () => Boolean(env.stripeKey);

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!client) client = new Stripe(env.stripeKey, { apiVersion: "2025-02-24.acacia" });
  return client;
}

export interface StripeCustomerLite {
  id: string;
  name: string | null;
  email: string | null;
  created: number;
  description: string | null;
}

// Candidate pool for fuzzy matching. Stripe's search syntax only does exact
// token-ish matching, so for small test accounts we pull one page of all
// customers and let match.ts score locally; search results are merged in for
// larger accounts where the listing page might miss the right customer.
export async function stripeCandidatePool(name: string, domain: string | null): Promise<StripeCustomerLite[]> {
  return cached(`stripe:pool:${name}:${domain}`, 120_000, async () => {
    const s = stripe();
    const byId = new Map<string, StripeCustomerLite>();
    const add = (c: Stripe.Customer) =>
      byId.set(c.id, { id: c.id, name: c.name ?? null, email: c.email ?? null, created: c.created, description: c.description ?? null });

    const listing = await s.customers.list({ limit: 100 });
    listing.data.forEach(add);

    const clauses: string[] = [];
    const firstToken = name.split(/\s+/)[0]?.replace(/[^a-z0-9]/gi, "");
    if (firstToken && firstToken.length >= 3) clauses.push(`name~"${firstToken}"`);
    if (domain) clauses.push(`email~"${domain}"`);
    if (clauses.length) {
      try {
        const found = await s.customers.search({ query: clauses.join(" OR "), limit: 20 });
        found.data.forEach(add);
      } catch {
        // search index can lag or be unavailable on new accounts; the listing
        // page already covers small accounts.
      }
    }
    return [...byId.values()];
  });
}

function invStatus(inv: Stripe.Invoice): Invoice["status"] {
  if (inv.status === "paid") return "paid";
  if (inv.status === "void") return "void";
  if (inv.status === "draft") return "draft";
  if (inv.status === "uncollectible") return "overdue";
  if (inv.due_date && inv.due_date * 1000 < Date.now()) return "overdue";
  return "open";
}

const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);

export interface StripeBilling {
  invoices: Invoice[];
  mrr: number;
  subscriptions: { id: string; status: string; monthly: number; productNames: string[] }[];
}

// One customer = 3 calls (invoices, subs, charges), all first-page (limit 100).
// Fine for per-company billing volume; a busy account would paginate here.
export async function stripeBilling(customerIds: string[]): Promise<StripeBilling> {
  const s = stripe();
  const out: StripeBilling = { invoices: [], mrr: 0, subscriptions: [] };
  await mapPool(customerIds, 3, async (cid) => {
    const [invoices, subs, charges] = await Promise.all([
      s.invoices.list({ customer: cid, limit: 100 }),
      s.subscriptions.list({ customer: cid, status: "all", limit: 100 }),
      s.charges.list({ customer: cid, limit: 100 }),
    ]);

    for (const inv of invoices.data) {
      out.invoices.push({
        source: "stripe",
        sourceCustomerId: cid,
        id: inv.id,
        number: inv.number ?? null,
        // effective_at lets seeded/backdated invoices carry their true date
        date: iso(inv.effective_at ?? inv.created),
        dueDate: iso(inv.due_date),
        amount: (inv.total ?? 0) / 100,
        amountPaid: (inv.amount_paid ?? 0) / 100,
        balance: (inv.amount_remaining ?? 0) / 100,
        status: invStatus(inv),
        memo: inv.description ?? null,
        duplicateOf: null,
      });
    }

    // Charges made outside an invoice (direct card charges) still count as
    // spend — surface them as paid pseudo-invoices so lifetime adds up.
    for (const ch of charges.data) {
      if (ch.invoice || !ch.paid || ch.refunded) continue;
      out.invoices.push({
        source: "stripe",
        sourceCustomerId: cid,
        id: ch.id,
        number: null,
        date: iso(ch.created),
        dueDate: null,
        amount: ch.amount / 100,
        amountPaid: ch.amount / 100,
        balance: 0,
        status: "paid",
        memo: ch.description ?? "Direct charge",
        duplicateOf: null,
      });
    }

    for (const sub of subs.data) {
      const active = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
      let monthly = 0;
      const names: string[] = [];
      for (const item of sub.items.data) {
        const price = item.price;
        const qty = item.quantity ?? 1;
        const unit = (price.unit_amount ?? 0) / 100;
        const interval = price.recurring?.interval;
        const count = price.recurring?.interval_count ?? 1;
        const perMonth =
          interval === "month" ? unit / count : interval === "year" ? unit / (12 * count) : interval === "week" ? (unit * 4.33) / count : 0;
        monthly += perMonth * qty;
        names.push(price.nickname || "subscription");
      }
      if (active) out.mrr += monthly;
      out.subscriptions.push({ id: sub.id, status: sub.status, monthly, productNames: names });
    }
  });
  return out;
}
