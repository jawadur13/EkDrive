import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../middleware/validation';
import { getSyncStatus, triggerSync, getConflicts, resolveConflict } from '../services/sync';
import { notFound } from '../utils/errors';

export const syncRoutes = new Hono();

const resolveSchema = z.object({ resolution: z.enum(['local', 'remote']) });

syncRoutes.get('/status', async (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json({ drives: await getSyncStatus(userId) });
});

syncRoutes.post('/trigger', async (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json(await triggerSync(userId));
});

syncRoutes.get('/conflicts', async (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json({ conflicts: await getConflicts(userId) });
});

syncRoutes.post('/conflicts/:conflictId{[0-9a-fA-F-]{36}}/resolve', async (c) => {
  const userId = (c as any).get('userId') as string;
  const conflictId = c.req.param('conflictId');
  const { resolution } = await parseBody(c, resolveSchema);
  const result = await resolveConflict(userId, conflictId, resolution);
  if (!result) throw notFound('Conflict');
  return c.json({ id: conflictId, message: 'Conflict resolved', result });
});
