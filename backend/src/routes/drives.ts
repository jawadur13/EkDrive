import { Hono } from 'hono';

export const driveRoutes = new Hono();

driveRoutes.get('/', async (c) => {
  return c.json({ drives: [] });
});

driveRoutes.post('/', async (c) => {
  return c.json({ id: 'placeholder-uuid', message: 'Drive connected' }, 201);
});

driveRoutes.get('/:driveId', async (c) => {
  const driveId = c.req.param('driveId');
  return c.json({ id: driveId, name: 'placeholder' });
});

driveRoutes.delete('/:driveId', async (c) => {
  const driveId = c.req.param('driveId');
  return c.json({ id: driveId, message: 'Drive disconnected' });
});

driveRoutes.get('/:driveId/health', async (c) => {
  const driveId = c.req.param('driveId');
  return c.json({ driveId, status: 'healthy', latencyMs: 0, quotaAvailable: 0 });
});