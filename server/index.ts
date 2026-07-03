import express from "express";
import crypto from "node:crypto";
import { env } from "./env.js";
import { buildDashboard, resolveCompany, sourceStatus } from "./dashboard.js";
import { companyDisplayName, listStageOptions, searchCompanies } from "./hubspot.js";
import { buildOverview, dealLineItems } from "./overview.js";
import { isScopeError } from "./util.js";
import { qboAuthUrl, qboConfigured, qboExchangeCode } from "./qbo.js";

const app = express();

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e) => {
      console.error(`[api] ${req.path}:`, e);
      res.status(500).json({ error: (e as Error).message });
    });

app.get("/api/status", (_req, res) => {
  res.json(sourceStatus());
});

app.get(
  "/api/companies",
  wrap(async (req, res) => {
    const results = await searchCompanies(String(req.query.q ?? ""));
    res.json(results.map((r) => ({ id: r.id, name: companyDisplayName(r.properties, r.id), domain: r.properties.domain || null })));
  }),
);

app.get(
  "/api/company/:id/resolve",
  wrap(async (req, res) => {
    res.json(await resolveCompany(req.params.id));
  }),
);

const idList = (v: unknown): string[] =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

app.get(
  "/api/company/:id/dashboard",
  wrap(async (req, res) => {
    res.json(await buildDashboard(req.params.id, idList(req.query.stripe), idList(req.query.qbo)));
  }),
);

app.get(
  "/api/deal-stages",
  wrap(async (_req, res) => {
    res.json(await listStageOptions());
  }),
);

app.get(
  "/api/deal/:id/line-items",
  wrap(async (req, res) => {
    try {
      res.json(await dealLineItems(req.params.id));
    } catch (e) {
      if (isScopeError(e)) {
        res.status(403).json({ error: "The API token cannot read line items (missing scope)." });
        return;
      }
      throw e;
    }
  }),
);

app.get(
  "/api/overview",
  wrap(async (req, res) => {
    const min = Number(req.query.min);
    const max = Number(req.query.max);
    const year = Number(req.query.year);
    const stages = idList(req.query.stages);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isInteger(year) || min < 0 || max < min || year < 2000 || year > 2100) {
      res.status(400).json({ error: "min, max and year are required (min ≤ max, year 2000-2100)" });
      return;
    }
    res.json(await buildOverview(min, max, year, stages));
  }),
);

// ---- QuickBooks OAuth (one-time browser flow) ----
const oauthStates = new Set<string>();

app.get("/api/qbo/connect", (_req, res) => {
  if (!qboConfigured()) {
    res.status(400).send("QUICKBOOKS_CLIENT_ID / SECRET missing in .env");
    return;
  }
  const state = crypto.randomBytes(12).toString("hex");
  oauthStates.add(state);
  res.redirect(qboAuthUrl(state));
});

app.get(
  "/api/qbo/callback",
  wrap(async (req, res) => {
    const { code, realmId, state, error } = req.query as Record<string, string>;
    if (error || !code || !realmId || !oauthStates.delete(state)) {
      res.status(400).send(`QuickBooks connection failed: ${error || "missing code/realm/state"}`);
      return;
    }
    await qboExchangeCode(code, realmId);
    res.redirect(`${env.webOrigin}/?qbo=connected`);
  }),
);

app.listen(env.apiPort, () => {
  const s = sourceStatus();
  console.log(`ReVue3 API on http://localhost:${env.apiPort}`);
  console.log(`  sources: hubspot=live stripe=${s.stripe ? "live" : "OFF"} quickbooks=${s.quickbooks}`);
});
