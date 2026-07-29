import { Hono } from 'hono';

export const storageModeRoutes = new Hono();

storageModeRoutes.get('/', async (c) => {
  return c.json({ mode: 'balanced', minReplicas: 1, rebalanceThreshold: 0.2 });
});

storageModeRoutes.put('/', async (c) => {
  const body = await c.req.json();
  return c.json({ ...body, message: 'Storage mode updated' });
});

storageModeRoutes.get('/rebalance', async (c) => {
  return c.json({ message: 'Rebalance triggered' });
});