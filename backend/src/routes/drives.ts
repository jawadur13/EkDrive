import { Hono } from 'hono';
import { z } from 'zod';
import { getDrivesByUser, getDriveById, createDrive, deleteDrive } from '../services/drives';
import { checkDriveHealth } from '../services/drive-health';

export const driveRoutes = new Hono();

const createDriveSchema = z.object({
  drive_name: z.string().min(1),
  google_drive_id: z.string().min(1),
  root_folder_id: z.string().min(1),
  oauth_token_encrypted: z.string().optional(),
  total_quota_bytes: z.number().int().nonnegative().optional(),
  used_quota_bytes: z.number().int().nonnegative().optional(),
});

driveRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const drives = await getDrivesByUser(userId);
  return c.json({ drives });
});

driveRoutes.post('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const body = await c.req.json();
  const parsed = createDriveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 422);
  }

  const drive = await createDrive(userId, parsed.data);
  return c.json(drive, 201);
});

driveRoutes.get('/:driveId', async (c) => {
  const userId = (c as any).get('userId') as string;
  const driveId = c.req.param('driveId');

  const drive = await getDriveById(userId, driveId);
  if (!drive) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Drive not found' } }, 404);
  }
  return c.json(drive);
});

driveRoutes.delete('/:driveId', async (c) => {
  const userId = (c as any).get('userId') as string;
  const driveId = c.req.param('driveId');

  try {
    await deleteDrive(userId, driveId);
    return c.json({ id: driveId, message: 'Drive disconnected' });
  } catch (error: any) {
    return c.json({ error: { code: 'NOT_FOUND', message: error.message || 'Drive not found' } }, 404);
  }
});

driveRoutes.get('/:driveId/health', async (c) => {
  const driveId = c.req.param('driveId');
  const health = await checkDriveHealth(driveId);
  if (!health) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Drive not found' } }, 404);
  }
  return c.json(health);
});
