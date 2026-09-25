import { Hono } from 'hono';
import { logActivity } from '../services/activity';
import { emptyTrash, listTrash, purgeTrashItem, restoreFile, TRASH_RETENTION_DAYS } from '../services/files';

export const trashRoutes = new Hono();

trashRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json({ items: await listTrash(userId), retentionDays: TRASH_RETENTION_DAYS });
});

trashRoutes.post('/:fileId{[0-9a-fA-F-]{36}}/restore', async (c) => {
  const userId = (c as any).get('userId') as string;
  const file = await restoreFile(userId, c.req.param('fileId'));
  await logActivity(userId, 'file.restored', file);
  return c.json(file);
});

trashRoutes.delete('/:fileId{[0-9a-fA-F-]{36}}', async (c) => {
  const userId = (c as any).get('userId') as string;
  const file = await purgeTrashItem(userId, c.req.param('fileId'));
  await logActivity(userId, 'file.deleted', file);
  return c.json({ id: file.id, message: 'Permanently deleted' });
});

trashRoutes.delete('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const count = await emptyTrash(userId);
  if (count > 0) await logActivity(userId, 'file.deleted', null, { emptiedTrash: count });
  return c.json({ deleted: count });
});
