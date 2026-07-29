import { Hono } from 'hono';
import { z } from 'zod';

export const fileRoutes = new Hono();

const createFileSchema = z.object({
  name: z.string().min(1).max(1024),
  parentFolderId: z.string().uuid().optional(),
  isFolder: z.boolean().default(false),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

fileRoutes.get('/', async (c) => {
  return c.json({ files: [], pagination: { nextCursor: null, hasMore: false, totalCount: 0 } });
});

fileRoutes.get('/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  return c.json({ id: fileId, name: 'placeholder' });
});

fileRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createFileSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 422);
  }
  return c.json({ id: 'placeholder-uuid', ...parsed.data }, 201);
});

fileRoutes.patch('/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  return c.json({ id: fileId, message: 'Updated' });
});

fileRoutes.delete('/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  return c.json({ id: fileId, message: 'Deleted' });
});

fileRoutes.get('/:fileId/download', async (c) => {
  const fileId = c.req.param('fileId');
  return c.json({ id: fileId, message: 'Download endpoint' });
});

fileRoutes.get('/:fileId/preview', async (c) => {
  const fileId = c.req.param('fileId');
  return c.json({ id: fileId, message: 'Preview endpoint' });
});

fileRoutes.get('/search', async (c) => {
  const query = c.req.query('q');
  return c.json({ query, results: [] });
});