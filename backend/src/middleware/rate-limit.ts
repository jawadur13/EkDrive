import { env } from '../env';
import { getConnInfo } from '@hono/node-server/conninfo';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60 * 1000;

type Options = {
  /** Requests allowed per minute. Defaults to RATE_LIMIT_MAX. */
  max?: number;
  /** Label kept in the key so two limiters never share a budget. */
  bucket?: string;
};

// In-memory, so limits are per process. Put a shared store (Redis) behind this before
// running more than one backend instance.
export function rateLimit({ max = env.rateLimitMax, bucket = 'default' }: Options = {}) {
  const store = new Map<string, RateLimitEntry>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  return async (c: any, next: any) => {
    const key = `${bucket}:${clientKey(c)}`;
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
      c.header('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } }, 429);
    }
    await next();
  };
}

// Signed-in requests are counted per user, so one busy network does not throttle everyone
// behind it. X-Forwarded-For is client-controlled, so it is trusted only behind our own proxy.
function clientKey(c: any): string {
  const userId = c.get?.('userId');
  if (userId) return `user:${userId}`;

  if (env.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return `ip:${forwarded}`;
  }
  try {
    return `ip:${getConnInfo(c).remote.address ?? 'unknown'}`;
  } catch {
    return 'ip:unknown';
  }
}
