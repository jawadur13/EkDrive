import { Hono } from 'hono';
import { z } from 'zod';
import { getStorageMode, updateStorageMode } from '../services/storage-mode';

export const storageModeRoutes = new Hono();

const updateSchema = z.object({
  mode: z.enum(['max_capacity', 'balanced', 'high_reliability']).optional(),
  min_replicas: z.number().int().min(1).max(5).optional(),
  rebalance_threshold: z.number().min(0).max(1).optional(),
});

storageModeRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const mode = await getStorageMode(userId);
  return c.json({
    mode: mode.mode,
    minReplicas: mode.min_replicas,
    rebalanceThreshold: mode.rebalance_threshold,
  });
});

storageModeRoutes.put('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const body = await c.req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 422);
  }

  const updated = await updateStorageMode(userId, parsed.data as any);
  return c.json({
    mode: updated.mode,
    minReplicas: updated.min_replicas,
    rebalanceThreshold: updated.rebalance_threshold,
    message: 'Storage mode updated',
  });
});

storageModeRoutes.get('/rebalance', async (c) => {
  return c.json({ message: 'Rebalance triggered' });
});
