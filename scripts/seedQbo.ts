// Seeds the QuickBooks sandbox with persona invoices/payments. QBO allows
// fully backdated TxnDate/DueDate, so this is where historical + overdue
// invoices live. Requires the app to be connected first (npm run dev →
// QuickBooks "connect" in the header). Idempotent: reuses customers by
// DisplayName and replaces their ReVue3-tagged invoices. Run: npm run seed:qbo
import { qboConnected, qboQuery, qboRequest } from "../server/qbo.js";
import { PERSONAS, TAG } from "./personas.js";

if (!qboConnected()) {
  console.error("QuickBooks is not connected. Start the app (npm run dev), click connect on the QuickBooks pill, then re-run.");
  process.exit(1);
}

interface Ref { value: string; name?: string }
interface QboEntity { Id: string; SyncToken: string; DisplayName?: string; Name?: string; PrivateNote?: string }

async function ensureItem(): Promise<Ref> {
  const items = await qboQuery<QboEntity>("SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 5");
  if (items.length) return { value: items[0].Id, name: items[0].Name };
  const created = await qboRequest<{ Item: QboEntity }>("/item?minorversion=75", {
    method: "POST",
    body: JSON.stringify({
      Name: "ReVue3 Services",
      Type: "Service",
      IncomeAccountRef: await incomeAccount(),
    }),
  });
  return { value: created.Item.Id };
}

async function incomeAccount(): Promise<Ref> {
  const accounts = await qboQuery<QboEntity>(
    "SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 1",
  );
  if (!accounts.length) throw new Error("no Income account in sandbox");
  return { value: accounts[0].Id };
}

async function ensureCustomer(name: string, email: string): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const existing = await qboQuery<QboEntity>(`SELECT * FROM Customer WHERE DisplayName = '${safe}'`);
  if (existing.length) return existing[0].Id;
  const created = await qboRequest<{ Customer: QboEntity }>("/customer?minorversion=75", {
    method: "POST",
    body: JSON.stringify({ DisplayName: name, PrimaryEmailAddr: { Address: email }, Notes: TAG }),
  });
  return created.Customer.Id;
}

async function deleteTaggedTxns(customerId: string) {
  // Payments must go before the invoices they pay.
  for (const entity of ["Payment", "Invoice"] as const) {
    const rows = await qboQuery<QboEntity>(
      `SELECT * FROM ${entity} WHERE CustomerRef = '${customerId}'`,
    );
    for (const r of rows) {
      if (entity === "Invoice" && !(r.PrivateNote ?? "").includes("ReVue3")) continue;
      await qboRequest(`/${entity.toLowerCase()}?operation=delete&minorversion=75`, {
        method: "POST",
        body: JSON.stringify({ Id: r.Id, SyncToken: r.SyncToken }),
      }).catch((e) => console.warn(`  could not delete ${entity} ${r.Id}: ${e.message}`));
    }
  }
}

async function main() {
  const item = await ensureItem();

  for (const p of PERSONAS) {
    if (!p.qbo) continue;
    const customerId = await ensureCustomer(p.qbo.customerName, p.qbo.email);
    await deleteTaggedTxns(customerId);

    for (const inv of p.qbo.invoices) {
      const created = await qboRequest<{ Invoice: QboEntity }>("/invoice?minorversion=75", {
        method: "POST",
        body: JSON.stringify({
          CustomerRef: { value: customerId },
          TxnDate: inv.txnDate,
          DueDate: inv.dueDate,
          DocNumber: inv.docNumber,
          PrivateNote: `${inv.memo} — ${TAG}`,
          Line: [
            {
              Amount: inv.amount,
              DetailType: "SalesItemLineDetail",
              Description: inv.memo,
              SalesItemLineDetail: { ItemRef: item, Qty: 1, UnitPrice: inv.amount },
            },
          ],
        }),
      });
      if (inv.payAmount > 0) {
        await qboRequest("/payment?minorversion=75", {
          method: "POST",
          body: JSON.stringify({
            CustomerRef: { value: customerId },
            TotalAmt: inv.payAmount,
            TxnDate: inv.txnDate,
            PrivateNote: TAG,
            Line: [
              {
                Amount: inv.payAmount,
                LinkedTxn: [{ TxnId: created.Invoice.Id, TxnType: "Invoice" }],
              },
            ],
          }),
        });
      }
    }
    console.log(`seeded ${p.qbo.customerName} (customer ${customerId}): ${p.qbo.invoices.length} invoices`);
  }
  console.log("QuickBooks seed complete.");
}

main().catch((e) => {
  console.error("seed failed:", e.message ?? e);
  process.exit(1);
});
