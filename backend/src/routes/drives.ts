import { Hono } from 'hono';
import { deleteDrive, DriveInUseError, getDriveById, getDrivesByUser } from '../services/drives';
import { checkDriveHealth } from '../services/drive-health';
import { HttpError, notFound } from '../utils/errors';
import { logActivity } from '../services/activity';

// Drives are added through GET /auth/connect (OAuth), not created directly.
export const driveRoutes = new Hono();

driveRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json({ drives: await getDrivesByUser(userId) });
});

driveRoutes.get('/:driveId{[0-9a-fA-F-]{36}}', async (c) => {
  const userId = (c as any).get('userId') as string;
  const drive = await getDriveById(userId, c.req.param('driveId'));
  if (!drive) throw notFound('Drive');
  return c.json(drive);
});

driveRoutes.delete('/:driveId{[0-9a-fA-F-]{36}}', async (c) => {
  const userId = (c as any).get('userId') as string;
  const driveId = c.req.param('driveId');
  try {
    const drive = await deleteDrive(userId, driveId);
    if (!drive) throw notFound('Drive');
    await logActivity(userId, 'drive.disconnected', null, { drive: drive.google_email ?? drive.drive_name });
  } catch (error) {
    if (error instanceof DriveInUseError) throw new HttpError(409, 'DRIVE_IN_USE', error.message);
    throw error;
  }
  return c.json({ id: driveId, message: 'Drive disconnected' });
});

driveRoutes.post('/:driveId{[0-9a-fA-F-]{36}}/health', async (c) => {
  const userId = (c as any).get('userId') as string;
  const drive = await getDriveById(userId, c.req.param('driveId'));
  if (!drive) throw notFound('Drive');
  return c.json(await checkDriveHealth(drive.id));
});
