import { Hono } from 'hono';
import { z } from 'zod';
import { createFolder, deleteFile, getFileById, listFiles, searchFiles, updateFile, uploadFile } from '../services/files';
import { getDrivesByUser } from '../services/drives';

export const fileRoutes = new Hono();

const createFileSchema = z.object({
  name: z.string().min(1).max(1024),
  parentFolderId: z.string().uuid().optional(),
  isFolder: z.boolean().default(false),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  driveId: z.string().uuid().optional(),
  googleFileId: z.string().optional(),
});

fileRoutes.get('/search', async (c) => {
  const userId = (c as any).get('userId') as string;
  const query = c.req.query('q');
  if (!query) {
    return c.json({ results: [] });
  }
  const results = await searchFiles(userId, query);
  return c.json({ query, results });
});

fileRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const parentFolderId = c.req.query('parentFolderId') || null;
  const cursor = c.req.query('cursor') || null;
  const limit = parseInt(c.req.query('limit') || '50');

  const result = await listFiles(userId, parentFolderId, cursor, limit);
  return c.json(result);
});

fileRoutes.get('/:fileId', async (c) => {
  const userId = (c as any).get('userId') as string;
  const fileId = c.req.param('fileId');

  const file = await getFileById(userId, fileId);
  if (!file) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404);
  }
  return c.json(file);
});

fileRoutes.post('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const body = await c.req.json();
  const parsed = createFileSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 422);
  }

  const { isFolder, name, parentFolderId, mimeType, sizeBytes, driveId, googleFileId } = parsed.data;

  if (isFolder) {
    const drives = await getDrivesByUser(userId);
    if (drives.length === 0) {
      return c.json({ error: { code: 'NO_DRIVES', message: 'No connected drives available' } }, 400);
    }
    const result = await createFolder(userId, name, parentFolderId || null, driveId || drives[0].id);
    return c.json(result, 201);
  }

  if (!driveId || !googleFileId) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'driveId and googleFileId required for file upload' } }, 422);
  }
  const result = await uploadFile(userId, name, parentFolderId || null, mimeType || 'application/octet-stream', sizeBytes || 0, driveId, googleFileId);
  return c.json(result, 201);
});

fileRoutes.patch('/:fileId', async (c) => {
  const userId = (c as any).get('userId') as string;
  const fileId = c.req.param('fileId');
  const body = await c.req.json();

  try {
    const result = await updateFile(userId, fileId, body);
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: { code: 'NOT_FOUND', message: error.message || 'File not found' } }, 404);
  }
});

fileRoutes.delete('/:fileId', async (c) => {
  const userId = (c as any).get('userId') as string;
  const fileId = c.req.param('fileId');

  try {
    await deleteFile(userId, fileId);
    return c.json({ id: fileId, message: 'Deleted' });
  } catch (error: any) {
    return c.json({ error: { code: 'NOT_FOUND', message: error.message || 'File not found' } }, 404);
  }
});
