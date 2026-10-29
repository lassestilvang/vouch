// Small in-memory limiter so a public demo can't drain credits or upstream API quotas.
const WINDOW_MS = 10 * 60_000;
const LIMIT = Number(process.env.VOUCH_RATE_LIMIT ?? 20);
const buckets = new Map<string, number[]>();

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

/** Spend `cost` units for `key`; returns false if that would exceed the window limit. */
export function allow(key: string, cost = 1) {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length + cost > LIMIT) {
    buckets.set(key, recent);
    return false;
  }
  for (let i = 0; i < cost; i++) recent.push(now);
  buckets.set(key, recent);
  return true;
}
