// Seeds Stripe test mode with the personas' billing. Historical invoices use
// `effective_at` for their true dates (test mode can't backdate `created`)
// and are paid with the pm_card_visa test card so amount_paid is real.
// Idempotent via customer metadata.seed = "revue3". Run: npm run seed:stripe
import Stripe from "stripe";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAS } from "./personas.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });
const key = process.env.STRIPE_KEY;
if (!key?.startsWith("sk_test_")) {
  console.error("STRIPE_KEY must be a test-mode key (sk_test_…) — refusing to seed.");
  process.exit(1);
}
const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });

const unix = (d: string) => Math.floor(new Date(`${d}T12:00:00Z`).getTime() / 1000);

async function cleanup() {
  let deleted = 0;
  for await (const c of stripe.customers.list({ limit: 100 })) {
    if (c.metadata?.seed !== "revue3") continue;
    // Cancel subs first so invoice generation stops, then drop the customer
    // (test-mode delete cascades to its invoices' visibility in our listing).
    const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 100 });
    for (const s of subs.data) if (s.status !== "canceled") await stripe.subscriptions.cancel(s.id).catch(() => {});
    await stripe.customers.del(c.id);
    deleted++;
  }
  console.log(`cleanup: deleted ${deleted} seeded customers`);
}

async function paidInvoice(customerId: string, amount: number, date: string, memo: string, pay: boolean, dueInDays?: number) {
  // Create the draft invoice FIRST and attach the item to it explicitly —
  // free-floating pending items get swept into whatever invoice is created
  // next (e.g. the subscription's), producing $0 invoices and one big lump.
  const inv = await stripe.invoices.create({
    customer: customerId,
    collection_method: pay ? "charge_automatically" : "send_invoice",
    days_until_due: pay ? undefined : (dueInDays ?? 30),
    effective_at: unix(date),
    description: memo,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
  });
  await stripe.invoiceItems.create({
    customer: customerId,
    invoice: inv.id,
    amount: Math.round(amount * 100),
    currency: "usd",
    description: memo,
  });
  // charge_automatically + default payment method pays at finalization
  const finalized = await stripe.invoices.finalizeInvoice(inv.id);
  if (pay && finalized.status !== "paid") await stripe.invoices.pay(inv.id);
  return inv.id;
}

async function main() {
  await cleanup();

  for (const p of PERSONAS) {
    if (!p.stripe) continue;
    const s = p.stripe;
    const customer = await stripe.customers.create({
      name: s.customerName,
      email: s.email,
      description: `${p.name} billing (ReVue3 seed)`,
      metadata: { seed: "revue3", persona: p.key },
    });
    const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });

    for (const inv of s.invoices)
      await paidInvoice(customer.id, inv.amount, inv.date, inv.memo, inv.paid, inv.dueInDays);

    if (s.monthlySub) {
      const product = await stripe.products.create({ name: s.monthlySub.product, metadata: { seed: "revue3" } });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(s.monthlySub.amount * 100),
        currency: "usd",
        recurring: { interval: "month" },
      });
      await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }] });
    }

    console.log(`seeded ${s.customerName} (${customer.id}): ${s.invoices.length} invoices${s.monthlySub ? " + monthly sub" : ""}`);
  }

  // Decoy: a plausible-but-wrong candidate so the sources panel shows a
  // lower-scored option the user could (but shouldn't) select.
  const decoy = await stripe.customers.create({
    name: "Bluepeak Software (legacy account)",
    email: "billing@bluepeak-legacy.example",
    description: "Stale duplicate from an old billing migration (ReVue3 seed)",
    metadata: { seed: "revue3", persona: "decoy" },
  });
  console.log(`seeded decoy customer ${decoy.id}`);
  console.log("Stripe seed complete.");
}

main().catch((e) => {
  console.error("seed failed:", e.message ?? e);
  process.exit(1);
});
