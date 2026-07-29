import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { rateLimit } from 'hono/rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return c.req.header('X-Forwarded-For') || 'unknown';
  },
});

export const apiRoutes = new Hono();

apiRoutes.use('/*', cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

apiRoutes.use('/*', apiLimiter);