import { Hono } from 'hono';
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import { getDecryptedTokens, getOAuthClient } from '../utils/drive-auth';

const prisma = new PrismaClient();

export const downloadRoutes = new Hono();

downloadRoutes.get('/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  const userId = (c as any).get('userId');

  const file = await prisma.file.findFirst({
    where: { id: fileId, user_id: userId },
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
    checksum: file.checksum,
    chunks: file.chunks.map((ch) => ({
      chunk_index: ch.chunk_index,
      drive_id: ch.drive_id,
      google_file_id: ch.google_file_id,
      size_bytes: ch.size_bytes,
      checksum: ch.checksum,
      upload_status: ch.upload_status,
    })),
  });
});

downloadRoutes.get('/:fileId/chunk/:chunkIndex', async (c) => {
  const fileId = c.req.param('fileId');
  const chunkIndex = parseInt(c.req.param('chunkIndex'));
  const userId = (c as any).get('userId');

  const chunk = await prisma.chunk.findFirst({
    where: { file_id: fileId, chunk_index: chunkIndex },
    include: { drive: true },
  });

  if (!chunk) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Chunk not found' } }, 404);
  }

  if (chunk.upload_status !== 'uploaded') {
    return c.json({ error: { code: 'NOT_READY', message: 'Chunk not yet uploaded' } }, 404);
  }

  const tokens = await getDecryptedTokens(chunk.drive.user_id);
  if (!tokens?.access_token) {
    return c.json({ error: { code: 'DRIVE_OFFLINE', message: 'Target drive is not accessible' } }, 503);
  }

  const oauth2Client = getOAuthClient(chunk.drive.user_id);
  const driveApi = google.drive({ version: 'v3', auth: oauth2Client });

  try {
    const response = await driveApi.files.get(
      { fileId: chunk.google_file_id, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    const chunkData = Buffer.from(response.data as ArrayBuffer);
    const actualChecksum = await computeChecksum(chunkData);

    if (actualChecksum !== chunk.checksum) {
      return c.json({ error: { code: 'CHECKSUM_MISMATCH', message: 'Chunk integrity check failed' } }, 500);
    }

    return c.body(chunkData, 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': chunkData.length.toString(),
    });
  } catch (error) {
    return c.json({ error: { code: 'DRIVE_ERROR', message: 'Failed to fetch chunk from Google Drive' } }, 502);
  }
});

async function computeChecksum(data: Buffer): Promise<string> {
  const xxhash = await import('xxhash-wasm');
  const hasher = await xxhash();
  return hasher.hash(data).toString(16);
}