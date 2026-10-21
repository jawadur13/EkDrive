import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireSameOrigin } from './csrf';
import { rateLimit } from './rate-limit';
import { HttpError } from '../utils/errors';

function appWith(middleware: any) {
  const app = new Hono();
  app.use('*', middleware);
  app.get('/', (c) => c.json({ ok: true }));
  app.post('/', (c) => c.json({ ok: true }));
  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: { code: error.code } }, error.status);
    throw error;
  });
  return app;
}

describe('rateLimit', () => {
  it('allows up to the limit, then answers 429 with Retry-After', async () => {
    const app = appWith(rateLimit({ max: 2, bucket: 'test-a' }));

    const first = await app.request('/');
    expect(first.status).toBe(200);
    expect(first.headers.get('x-ratelimit-limit')).toBe('2');
    expect(first.headers.get('x-ratelimit-remaining')).toBe('1');

    expect((await app.request('/')).status).toBe(200);

    const blocked = await app.request('/');
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as any).error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('counts each signed-in user separately', async () => {
    const app = new Hono();
    // Stands in for the auth middleware, which runs first in the real app.
    app.use('*', async (c, next) => {
      c.set('userId' as never, c.req.header('x-test-user') as never);
      await next();
    });
    app.use('*', rateLimit({ max: 1, bucket: 'test-b' }));
    app.get('/', (c) => c.json({ ok: true }));

    expect((await app.request('/', { headers: { 'x-test-user': 'alice' } })).status).toBe(200);
    expect((await app.request('/', { headers: { 'x-test-user': 'alice' } })).status).toBe(429);
    // Bob still has his own budget.
    expect((await app.request('/', { headers: { 'x-test-user': 'bob' } })).status).toBe(200);
  });

  it('keeps separate buckets apart', async () => {
    const a = appWith(rateLimit({ max: 1, bucket: 'bucket-one' }));
    const b = appWith(rateLimit({ max: 1, bucket: 'bucket-two' }));
    expect((await a.request('/')).status).toBe(200);
    expect((await a.request('/')).status).toBe(429);
    expect((await b.request('/')).status).toBe(200);
  });
});

describe('requireSameOrigin', () => {
  const app = appWith(requireSameOrigin);
  const frontend = process.env.CORS_ORIGIN || 'http://localhost:5173';

  it('lets reads through whatever the origin', async () => {
    expect((await app.request('/', { headers: { Origin: 'https://evil.example' } })).status).toBe(200);
  });

  it('accepts a write from our own frontend', async () => {
    const res = await app.request('/', { method: 'POST', headers: { Origin: frontend, Cookie: 'access_token=x' } });
    expect(res.status).toBe(200);
  });

  it('rejects a write from somewhere else', async () => {
    const res = await app.request('/', { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: 'access_token=x' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe('BAD_ORIGIN');
  });

  it('rejects a cookie write with no origin at all', async () => {
    const res = await app.request('/', { method: 'POST', headers: { Cookie: 'access_token=x' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe('ORIGIN_REQUIRED');
  });

  it('leaves bearer-token and cookieless clients alone', async () => {
    expect((await app.request('/', { method: 'POST', headers: { Authorization: 'Bearer t', Origin: 'https://evil.example' } })).status).toBe(200);
    expect((await app.request('/', { method: 'POST' })).status).toBe(200);
  });
});
