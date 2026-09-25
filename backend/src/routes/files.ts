import { Hono } from 'hono';
import { z } from 'zod';
import { createFolder, getBreadcrumbs, getFileById, listFiles, searchFiles, trashFile, updateFile } from '../services/files';
import { logActivity } from '../services/activity';
import { repairFile } from '../services/replication';
import { parseBody } from '../middleware/validation';
import { notFound } from '../utils/errors';

export const fileRoutes = new Hono();

const createFolderSchema = z.object({
  name: z.string().min(1).max(1024),
  parentFolderId: z.string().uuid().nullish(),
});

const updateFileSchema = z
  .object({
    name: z.string().min(1).max(1024).optional(),
    parentFolderId: z.string().uuid().nullable().optional(),
  })
  .strict();

fileRoutes.get('/search', async (c) => {
  const userId = (c as any).get('userId') as string;
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ query: '', results: [] });
  return c.json({ query, results: await searchFiles(userId, query) });
});

fileRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const parentFolderId = c.req.query('parentFolderId') || null;
  const limit = parseInt(c.req.query('limit') || '50') || 50;
  return c.json(await listFiles(userId, parentFolderId, c.req.query('cursor') || null, limit));
});

// Folders only — file contents go through /upload.
fileRoutes.post('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const { name, parentFolderId } = await parseBody(c, createFolderSchema);
  const folder = await createFolder(userId, name, parentFolderId ?? null);
  await logActivity(userId, 'folder.created', folder);
  return c.json(folder, 201);
});

fileRoutes.get('/:fileId{[0-9a-fA-F-]{36}}', async (c) => {
  const userId = (c as any).get('userId') as string;
  const file = await getFileById(userId, c.req.param('fileId'));
  if (!file) throw notFound('File');
  return c.json(file);
});

fileRoutes.get('/:fileId{[0-9a-fA-F-]{36}}/breadcrumbs', async (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json({ breadcrumbs: await getBreadcrumbs(userId, c.req.param('fileId')) });
});

fileRoutes.patch('/:fileId{[0-9a-fA-F-]{36}}', async (c) => {
  const userId = (c as any).get('userId') as string;
  const data = await parseBody(c, updateFileSchema);
  const before = await getFileById(userId, c.req.param('fileId'));
  const updated = await updateFile(userId, c.req.param('fileId'), data);
  if (before && before.name !== updated.name) await logActivity(userId, 'file.renamed', updated, { from: before.name });
  if (before && before.parent_id !== updated.parent_id) {
    await logActivity(userId, 'file.moved', updated, { from: before.virtual_path, to: updated.virtual_path });
  }
  return c.json(updated);
});

fileRoutes.delete('/:fileId{[0-9a-fA-F-]{36}}', async (c) => {
  const userId = (c as any).get('userId') as string;
  const file = await trashFile(userId, c.req.param('fileId'));
  await logActivity(userId, 'file.trashed', file);
  return c.json({ id: file.id, message: 'Moved to trash' });
});

// Rebuilds missing copies of a file's chunks from the remaining ones.
fileRoutes.post('/:fileId{[0-9a-fA-F-]{36}}/repair', async (c) => {
  const userId = (c as any).get('userId') as string;
  const file = await getFileById(userId, c.req.param('fileId'));
  if (!file) throw notFound('File');
  const result = await repairFile(file.id);
  if (result.copiesAdded > 0 || result.copiesRemoved > 0) await logActivity(userId, 'file.repaired', file, result);
  return c.json(result);
});
