import { Hono } from 'hono';
import { prisma } from '../db/client';

export const previewRoutes = new Hono();

previewRoutes.get('/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  const file = await prisma.file.findUnique({ where: { id: fileId } });

  if (!file) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404);
  }

  const previewableTypes = ['image/', 'application/pdf', 'text/', 'video/', 'audio/'];
  const isPreviewable = previewableTypes.some((type) => file.mime_type?.startsWith(type));

  return c.json({
    file_id: file.id,
    name: file.name,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    previewable: isPreviewable,
    chunks: file.is_chunked,
  });
});

previewRoutes.get('/:fileId/stream', async (c) => {
  const fileId = c.req.param('fileId');
  const range = c.req.header('Range');
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    include: { chunks: { orderBy: { chunk_index: 'asc' } } },
  });

  if (!file) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404);
  }

  return c.json({
    file_id: file.id,
    name: file.name,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    range: range || null,
    message: 'Streaming endpoint — chunks are fetched from Google Drive',
  });
});

previewRoutes.get('/:fileId/thumbnail', async (c) => {
  const fileId = c.req.param('fileId');
  return c.json({ file_id: fileId, thumbnail_url: null, message: 'Thumbnail generation is async' });
});