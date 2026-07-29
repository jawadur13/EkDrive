import { Hono } from 'hono';

export const syncRoutes = new Hono();

syncRoutes.get('/status', async (c) => {
  return c.json({ drives: [], lastSync: null });
});

syncRoutes.post('/trigger', async (c) => {
  return c.json({ message: 'Sync triggered' });
});

syncRoutes.get('/conflicts', async (c) => {
  return c.json({ conflicts: [] });
});

syncRoutes.post('/conflicts/:conflictId/resolve', async (c) => {
  const conflictId = c.req.param('conflictId');
  return c.json({ id: conflictId, message: 'Conflict resolved' });
});