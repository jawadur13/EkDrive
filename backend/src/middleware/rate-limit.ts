import { Hono } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || '100');

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

export function rateLimit() {
  return async (c: any, next: any) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const now = Date.now();

    let entry = store.get(ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      store.set(ip, entry);
    }

    entry.count++;

    c.header('X-RateLimit-Limit', String(MAX_REQUESTS));
    c.header('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > MAX_REQUESTS) {
      return c.json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later' } }, 429);
    }

    await next();
  };
}
