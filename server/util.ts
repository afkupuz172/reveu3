export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

// Retry 429s (honoring Retry-After) and transient 5xx with exponential backoff.
export async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 5): Promise<T> {
  let delay = 500;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retryable =
        e instanceof HttpError && (e.status === 429 || e.status >= 500 || e.status === 0);
      if (!retryable || attempt >= tries) throw e;
      const wait = e instanceof HttpError && e.retryAfterMs ? e.retryAfterMs : delay;
      console.warn(`[retry] ${label}: ${(e as Error).message} — retrying in ${wait}ms (${attempt}/${tries})`);
      await sleep(wait);
      delay = Math.min(delay * 2, 8000);
    }
  }
}

// Bounded-concurrency map, preserving order. Keeps us well under burst limits
// without serializing everything.
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// TTL cache with in-flight dedupe: concurrent callers of the same key await a
// single upstream request instead of stampeding the API.
const store = new Map<string, { at: number; ttl: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = fn()
    .then((value) => {
      store.set(key, { at: Date.now(), ttl: ttlMs, value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// HubSpot answers 403 (category MISSING_SCOPES) when the private-app token
// lacks a scope for one object type; other sources use 401/403 similarly.
// These are per-block failures, not fatal ones — callers degrade gracefully.
export const isScopeError = (e: unknown): boolean =>
  e instanceof HttpError && (e.status === 403 || /scope/i.test(e.message));

// Run one data block, converting a scope failure into a reported issue while
// the rest of the page keeps loading.
export async function scoped<T>(
  section: string,
  fallback: T,
  issues: { section: string; message: string }[],
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isScopeError(e)) throw e;
    issues.push({
      section,
      message: `The API token cannot read ${section} (missing scope) — this block is omitted.`,
    });
    console.warn(`[scope] ${section}: ${(e as Error).message}`);
    return fallback;
  }
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
