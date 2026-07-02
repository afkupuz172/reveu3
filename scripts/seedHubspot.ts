// Seeds the demo HubSpot portal with the ReVue3 personas. Idempotent: every
// seeded record carries the TAG in a searchable text property, and the script
// deletes previously tagged records before recreating.
//
// Needs private-app scopes: crm.objects.{companies,contacts,deals,line_items}.write
// + tickets write. Run: npm run seed:hubspot
import { hsFetch } from "../server/hubspot.js";
import { chunk, mapPool, sleep } from "../server/util.js";
import { PERSONAS, TAG } from "./personas.js";

const iso = (d: string) => new Date(`${d}T12:00:00Z`).toISOString();

async function searchIds(type: string, filters: unknown[]): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const res = await hsFetch<{ results: { id: string }[]; paging?: { next?: { after: string } } }>(
      `/crm/v3/objects/${type}/search`,
      { method: "POST", body: JSON.stringify({ filterGroups: [{ filters }], limit: 100, ...(after ? { after } : {}) }) },
    );
    ids.push(...res.results.map((r) => r.id));
    after = res.paging?.next?.after;
  } while (after);
  return ids;
}

async function archiveAll(type: string, ids: string[]) {
  for (const batch of chunk(ids, 100))
    await hsFetch(`/crm/v3/objects/${type}/batch/archive`, {
      method: "POST",
      body: JSON.stringify({ inputs: batch.map((id) => ({ id })) }),
    });
}

async function cleanup() {
  const tagFilter = (prop: string) => [{ propertyName: prop, operator: "CONTAINS_TOKEN", value: "ReVue3" }];

  const dealIds = await searchIds("deals", tagFilter("description"));
  if (dealIds.length) {
    // Line items die with their deals only if we archive them explicitly.
    const li = await hsFetch<{ results: { from: { id: string }; to: { toObjectId: string }[] }[] }>(
      "/crm/v4/associations/deals/line_items/batch/read",
      { method: "POST", body: JSON.stringify({ inputs: dealIds.slice(0, 100).map((id) => ({ id })) }) },
    ).catch(() => ({ results: [] }));
    const liIds = li.results.flatMap((r) => r.to.map((t) => String(t.toObjectId)));
    if (liIds.length) await archiveAll("line_items", liIds);
    await archiveAll("deals", dealIds);
  }

  const ticketIds = await searchIds("tickets", tagFilter("content"));
  if (ticketIds.length) await archiveAll("tickets", ticketIds);

  const emails = PERSONAS.flatMap((p) => p.contacts.map((c) => c.email));
  const contactIds = await searchIds("contacts", [{ propertyName: "email", operator: "IN", values: emails }]);
  if (contactIds.length) await archiveAll("contacts", contactIds);

  const companyIds = await searchIds("companies", tagFilter("description"));
  if (companyIds.length) await archiveAll("companies", companyIds);

  console.log(
    `cleanup: archived ${dealIds.length} deals, ${ticketIds.length} tickets, ${contactIds.length} contacts, ${companyIds.length} companies`,
  );
  if (dealIds.length || companyIds.length) await sleep(2000); // let the search index settle
}

interface Created {
  id: string;
}

async function create(type: string, properties: Record<string, unknown>, associations?: unknown[]): Promise<string> {
  const res = await hsFetch<Created>(`/crm/v3/objects/${type}`, {
    method: "POST",
    body: JSON.stringify({ properties, ...(associations ? { associations } : {}) }),
  });
  return res.id;
}

// v4 "default" association endpoint picks the standard association type for
// the object pair — no hardcoded typeIds needed (incl. deal↔deal).
async function associate(fromType: string, fromId: string, toType: string, toId: string) {
  await hsFetch(`/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`, { method: "PUT" });
}

async function main() {
  await cleanup();

  for (const p of PERSONAS) {
    const companyId = await create("companies", {
      name: p.name,
      domain: p.domain,
      industry: p.industry,
      city: p.city,
      description: TAG,
    });

    for (const c of p.contacts) {
      const contactId = await create("contacts", { firstname: c.first, lastname: c.last, email: c.email });
      await associate("contacts", contactId, "companies", companyId);
    }

    const dealIdByKey = new Map<string, string>();
    for (const d of p.deals) {
      const dealId = await create("deals", {
        dealname: d.name,
        amount: String(d.amount),
        closedate: iso(d.close),
        dealstage: d.stage,
        pipeline: "default",
        dealtype: d.type,
        description: TAG,
      });
      dealIdByKey.set(d.key, dealId);
      await associate("deals", dealId, "companies", companyId);

      await mapPool(d.lineItems, 2, async (li) => {
        const liId = await create("line_items", {
          name: li.name,
          quantity: String(li.quantity),
          price: String(li.price),
          ...(li.recurring ? { recurringbillingfrequency: li.recurring } : {}),
        });
        await associate("line_items", liId, "deals", dealId);
      });
    }

    // deal↔deal pairing is what the Overview's association scan discovers
    for (const d of p.deals)
      if (d.pairWith) await associate("deals", dealIdByKey.get(d.key)!, "deals", dealIdByKey.get(d.pairWith)!);

    for (const t of p.tickets) {
      const ticketId = await create("tickets", {
        subject: t.subject,
        content: TAG,
        hs_pipeline: "0",
        hs_pipeline_stage: t.stage,
        hs_ticket_priority: t.priority,
      });
      await associate("tickets", ticketId, "companies", companyId);
    }

    console.log(`seeded ${p.name} (company ${companyId}): ${p.deals.length} deals, ${p.tickets.length} tickets`);
  }
  console.log("HubSpot seed complete.");
}

main().catch((e) => {
  console.error("seed failed:", e.message ?? e);
  process.exit(1);
});
