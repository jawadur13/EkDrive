import { Hono } from 'hono';
import { prisma } from '../db/client';

export const downloadRoutes = new Hono();

downloadRoutes.get('/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
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
    size_bytes: file.size_bytes,
    mime_type: file.mime_type,
    is_chunked: file.is_chunked,
    chunk_count: file.chunk_count,
    chunks: file.chunks.map((ch) => ({
      chunk_index: ch.chunk_index,
      drive_id: ch.drive_id,
      google_file_id: ch.google_file_id,
      size_bytes: ch.size_bytes,
      checksum: ch.checksum,
    })),
  });
});

downloadRoutes.get('/:fileId/chunk/:chunkIndex', async (c) => {
  const fileId = c.req.param('fileId');
  const chunkIndex = parseInt(c.req.param('chunkIndex'));

  const chunk = await prisma.chunk.findUnique({
    where: { file_id_chunk_index: { file_id: fileId, chunk_index: chunkIndex } },
    include: { drive: true },
  });

  if (!chunk) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Chunk not found' } }, 404);
  }

  return c.json({
    chunk_index: chunk.chunk_index,
    drive_id: chunk.drive_id,
    google_file_id: chunk.google_file_id,
    size_bytes: chunk.size_bytes,
  });
});