# ReVue3

Single-user local dashboard that fuses **HubSpot** (CRM anchor), **Stripe**, and
**QuickBooks Online** into a per-company revenue view plus a portfolio-level
NRR overview. All API keys stay server-side.

## Run

```bash
npm install
npm run dev        # API on :3001 + web on :5173 (proxied)
```

`.env` (gitignored): `HUBSPOT_PA_KEY` (private-app token, required),
`STRIPE_KEY` (sk_test_…), `QUICKBOOKS_CLIENT_ID/SECRET` (+ optional
`QUICKBOOKS_ENV=sandbox`, `API_PORT`).

**QuickBooks** needs a one-time browser OAuth: start the app and click
**connect** on the QuickBooks pill in the header. The refresh token + realm
persist in `.qbo-token.json` (gitignored). The redirect URI
`http://localhost:3001/api/qbo/callback` must be registered on the Intuit app's
**Development** keys.

## Seeding the demo accounts

```bash
npm run seed:hubspot   # companies, contacts, paired deals (+line items), tickets
npm run seed:stripe    # messy-named customers, backdated invoices, subscriptions
npm run seed:qbo       # customers + backdated/partial/overdue invoices (connect first)
```

All three are idempotent (tagged `ReVue3 seed` / `metadata.seed=revue3`) —
re-running replaces prior seed data. Personas live in `scripts/personas.ts` and
cover every NRR outcome: expansion 125%, contraction 75%, flat 100%, churn 0%,
pending 133%, plus an unpaired deal, a cross-source duplicate invoice
(Ferrostar in both Stripe and QBO), a name-mismatch ledger (Marlowe), an
email-domain-only match (Q.D. Labs), and a decoy Stripe customer.

## Tabs

**Dashboard** — search a HubSpot company, then:
- *Billing data sources*: fuzzy-matched Stripe/QBO customers with match score,
  scoring reasons, include/exclude toggles, and per-source contribution — this
  is the visualization of where billing numbers come from.
- KPIs: lifetime spend, MRR (Stripe subs, HubSpot recurring fallback), ARR,
  outstanding/resolved invoices, open pipeline, won-to-date.
- Sortable deals table (current + past) with per-deal deep dive: pipeline,
  stage progress, products, MRR/ARR, and billing corroboration (fuzzy
  invoice↔deal match: amount ±2% or its monthly 1/12, within 120 days of close).
- Invoices (outstanding/resolved, cross-source duplicates flagged) and tickets.

**Overview** — pick a value range + close year:
- Finds deals in range, pairs each with its associated deal (deduped), baseline
  = earlier close (must be closed-won), change = later deal. NRR = change ÷
  baseline; lost change deal = churn (0%); recurring NRR from `hs_arr`.
- Sortable pair table, cumulative revenue overlay (realized vs expected by
  year), NRR-by-pair chart, cohort totals.

## API-efficiency choices

- HubSpot reads go through **batch endpoints** (100 ids/call) and v4 batch
  associations; the overview costs ~4 calls regardless of cohort size, a
  dashboard ~10.
- TTL caches with in-flight dedupe (searches 30s, dashboards 60s, overview
  120s, pipelines 10min, QBO customers 5min).
- 429/5xx retry honoring `Retry-After`; bounded concurrency (`mapPool`).
- QBO requests are **serialized** (sandbox throttles concurrency) and the
  rotating refresh token is refreshed single-flight.

## Layout

`server/` Express API (hubspot/stripe/qbo clients, match scoring, dashboard +
overview assembly) · `src/` React UI · `shared/types.ts` API contract ·
`scripts/` seeders.
