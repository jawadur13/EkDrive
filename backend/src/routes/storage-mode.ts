import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../middleware/validation';
import { getStorageMode, updateStorageMode } from '../services/storage-mode';
import { logActivity } from '../services/activity';
import { notify } from '../services/notifications';
import { isRebalancing, runExclusiveRebalance } from '../services/replication';
import { HttpError } from '../utils/errors';

export const storageModeRoutes = new Hono();

const updateSchema = z.object({
  mode: z.enum(['max_capacity', 'balanced', 'high_reliability']).optional(),
  min_replicas: z.number().int().min(1).max(5).optional(),
  rebalance_threshold: z.number().min(0).max(1).optional(),
});

const toResponse = (mode: Awaited<ReturnType<typeof getStorageMode>>) => ({
  mode: mode.mode,
  minReplicas: mode.min_replicas,
  rebalanceThreshold: mode.rebalance_threshold,
});

// A mode change applies to new uploads; POST /rebalance applies it to existing files.
storageModeRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json(toResponse(await getStorageMode(userId)));
});

storageModeRoutes.put('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const data = await parseBody(c, updateSchema);
  const before = await getStorageMode(userId);
  const updated = await updateStorageMode(userId, data);
  if (before.mode !== updated.mode) await logActivity(userId, 'storage_mode.changed', null, { from: before.mode, to: updated.mode });
  return c.json(toResponse(updated));
});

storageModeRoutes.get('/rebalance', (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json({ running: isRebalancing(userId) });
});

// Runs in the background: it moves data between Google accounts and can take a while.
// The user gets a notification when it finishes.
storageModeRoutes.post('/rebalance', (c) => {
  const userId = (c as any).get('userId') as string;
  if (isRebalancing(userId)) throw new HttpError(409, 'ALREADY_RUNNING', 'A rebalance is already running');

  runExclusiveRebalance(userId)
    .then(async (result) => {
      if (!result) return;
      await logActivity(userId, 'storage.rebalanced', null, result);
      await notify(userId, {
        type: 'rebalance.done',
        severity: result.lostChunks > 0 ? 'warning' : 'info',
        title: 'Rebalance finished',
        body: `${result.filesAdjusted} file(s) adjusted, ${result.copiesAdded} copies added, ${result.copiesRemoved} removed, ${result.chunksMoved} chunk(s) moved.${
          result.lostChunks > 0 ? ` ${result.lostChunks} chunk(s) had no readable copy.` : ''
        }`,
      });
    })
    .catch((error) => console.error(`Rebalance failed for ${userId}:`, error));

  return c.json({ running: true }, 202);
});
