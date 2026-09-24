import { env } from '../env';
import { getConnInfo } from '@hono/node-server/conninfo';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60 * 1000;

// In-memory, so limits are per process. Put a shared store (Redis) behind this before
// running more than one backend instance.
export function rateLimit(max = env.rateLimitMax) {
  const store = new Map<string, RateLimitEntry>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  return async (c: any, next: any) => {
    const key = clientKey(c);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      store.set(key, entry);
    }
    entry.count++;

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      return c.json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later' } }, 429);
    }
    await next();
  };
}

// X-Forwarded-For is client-controlled; only trust it when a proxy we run sets it.
function clientKey(c: any): string {
  if (env.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
