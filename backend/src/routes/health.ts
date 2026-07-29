import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

healthRoutes.get('/drives', async (c) => {
  return c.json({ drives: [] });
});