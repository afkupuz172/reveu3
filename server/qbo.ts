// QuickBooks Online client. Auth is a one-time browser OAuth (Intuit has no
// API-key mode); the refresh token + realm persist in .qbo-token.json
// (gitignored). Intuit ROTATES the refresh token on every refresh, so refresh
// is single-flight, and the sandbox throttles concurrency, so all queries go
// through a serialized queue with 429 retry.
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";
import { HttpError, cached, sleep } from "./util.js";
import type { Invoice } from "../shared/types.js";

const TOKEN_FILE = path.join(env.root, ".qbo-token.json");
const API_BASE =
  env.qboEnv === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

interface QboToken {
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: number;
  realmId: string;
}

let token: QboToken | null = null;
function loadToken(): QboToken | null {
  if (token) return token;
  try {
    token = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    token = null;
  }
  return token;
}
function saveToken(t: QboToken) {
  token = t;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));
}

export const qboConfigured = () => Boolean(env.qboClientId && env.qboClientSecret);
export const qboConnected = () => Boolean(loadToken());

export const qboRedirectUri = `http://localhost:${env.apiPort}/api/qbo/callback`;

export function qboAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.qboClientId,
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: qboRedirectUri,
    response_type: "code",
    state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${p}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const basic = Buffer.from(`${env.qboClientId}:${env.qboClientSecret}`).toString("base64");
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new HttpError(res.status, `QBO token exchange ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

export async function qboExchangeCode(code: string, realmId: string): Promise<void> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: qboRedirectUri });
  saveToken({
    refreshToken: t.refresh_token,
    accessToken: t.access_token,
    accessExpiresAt: Date.now() + (t.expires_in - 120) * 1000,
    realmId,
  });
}

let refreshing: Promise<void> | null = null;
async function ensureAccessToken(): Promise<QboToken> {
  const t = loadToken();
  if (!t) throw new HttpError(401, "QuickBooks not connected");
  if (Date.now() < t.accessExpiresAt) return t;
  refreshing ??= (async () => {
    const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken });
    saveToken({
      refreshToken: fresh.refresh_token,
      accessToken: fresh.access_token,
      accessExpiresAt: Date.now() + (fresh.expires_in - 120) * 1000,
      realmId: t.realmId,
    });
  })().finally(() => (refreshing = null));
  await refreshing;
  return loadToken()!;
}

// Serialized queue: sandbox rejects concurrent requests far below the
// documented limit, so one request at a time with backoff is the reliable mode.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function qboRequest<T>(pathAndQuery: string, init?: RequestInit): Promise<T> {
  return enqueue(async () => {
    for (let attempt = 1; ; attempt++) {
      const t = await ensureAccessToken();
      const res = await fetch(`${API_BASE}/v3/company/${t.realmId}${pathAndQuery}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${t.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
      if (res.status === 429 && attempt < 5) {
        await sleep(1200 * attempt);
        continue;
      }
      if (res.status === 401 && attempt < 3) {
        token = loadToken();
        if (token) token.accessExpiresAt = 0; // force refresh next loop
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, `QBO ${res.status} ${pathAndQuery.split("?")[0]}: ${(await res.text()).slice(0, 300)}`);
      return (await res.json()) as T;
    }
  });
}

export async function qboQuery<T>(sql: string): Promise<T[]> {
  const res = await qboRequest<{ QueryResponse: Record<string, T[] | number> }>(
    `/query?minorversion=75&query=${encodeURIComponent(sql)}`,
  );
  const key = Object.keys(res.QueryResponse).find((k) => Array.isArray((res.QueryResponse as Record<string, unknown>)[k]));
  return key ? (res.QueryResponse[key] as T[]) : [];
}

export interface QboCustomer {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
  WebAddr?: { URI: string };
  Balance?: number;
}

// Sandbox datasets are small; pull all customers once and score locally.
export async function qboCustomers(): Promise<QboCustomer[]> {
  return cached("qbo:customers", 300_000, () =>
    qboQuery<QboCustomer>("SELECT * FROM Customer WHERE Active = true MAXRESULTS 1000"),
  );
}

interface QboInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  PrivateNote?: string;
  CustomerRef?: { value: string };
}

export async function qboBilling(customerIds: string[]): Promise<{ invoices: Invoice[] }> {
  if (!customerIds.length) return { invoices: [] };
  const idList = customerIds.map((id) => `'${id.replace(/'/g, "")}'`).join(",");
  const rows = await qboQuery<QboInvoice>(
    `SELECT * FROM Invoice WHERE CustomerRef IN (${idList}) ORDERBY TxnDate MAXRESULTS 1000`,
  );
  const today = new Date().toISOString().slice(0, 10);
  const invoices: Invoice[] = rows.map((r) => {
    const amount = r.TotalAmt ?? 0;
    const balance = r.Balance ?? 0;
    const status: Invoice["status"] =
      balance === 0 ? "paid" : r.DueDate && r.DueDate < today ? "overdue" : "open";
    return {
      source: "quickbooks",
      sourceCustomerId: r.CustomerRef?.value ?? "",
      id: r.Id,
      number: r.DocNumber ?? null,
      date: r.TxnDate ? `${r.TxnDate}T00:00:00.000Z` : null,
      dueDate: r.DueDate ? `${r.DueDate}T00:00:00.000Z` : null,
      amount,
      amountPaid: amount - balance,
      balance,
      status,
      memo: r.PrivateNote ?? null,
      duplicateOf: null,
    };
  });
  return { invoices };
}
