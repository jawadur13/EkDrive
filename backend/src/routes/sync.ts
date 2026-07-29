import { Hono } from 'hono';
import { getSyncStatus, triggerSync, getConflicts, resolveConflict } from '../services/sync';

export const syncRoutes = new Hono();

syncRoutes.get('/status', async (c) => {
  const userId = (c as any).get('userId') as string;
  const status = await getSyncStatus(userId);
  return c.json({ drives: status, lastSync: null });
});

syncRoutes.post('/trigger', async (c) => {
  const userId = (c as any).get('userId') as string;
  const result = await triggerSync(userId);
  return c.json(result);
});

syncRoutes.get('/conflicts', async (c) => {
  const userId = (c as any).get('userId') as string;
  const conflicts = await getConflicts(userId);
  return c.json({ conflicts });
});

syncRoutes.post('/conflicts/:conflictId/resolve', async (c) => {
  const userId = (c as any).get('userId') as string;
  const conflictId = c.req.param('conflictId');
  const body = await c.req.json();

  const result = await resolveConflict(userId, conflictId, body.resolution || 'local');
  return c.json({ id: conflictId, message: 'Conflict resolved', result });
});
