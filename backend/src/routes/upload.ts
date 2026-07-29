import { Hono } from 'hono';
import { z } from 'zod';

export const uploadRoutes = new Hono();

uploadRoutes.post('/init', async (c) => {
  const body = await c.req.json();
  const { name, size_bytes, mime_type, parent_folder_id, total_chunks, chunk_checksums, file_checksum } = body;

  if (!name || !size_bytes || !total_chunks) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } }, 422);
  }

  return c.json({
    file_id: 'placeholder-uuid',
    placement: [{ chunk_index: 0, drive_id: 'placeholder-drive', chunk_size: size_bytes }],
    chunk_size: parseInt(process.env.CHUNK_SIZE_BYTES || '52428800'),
  }, 201);
});

uploadRoutes.post('/:fileId/chunk/:chunkIndex', async (c) => {
  const fileId = c.req.param('fileId');
  const chunkIndex = parseInt(c.req.param('chunkIndex'));

  return c.json({ chunk_id: 'placeholder', file_id: fileId, chunk_index: chunkIndex, status: 'uploaded' });
});

uploadRoutes.post('/:fileId/complete', async (c) => {
  const fileId = c.req.param('fileId');
  return c.json({ file_id: fileId, status: 'ready' });
});