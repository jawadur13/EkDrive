import { Hono } from 'hono';
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import { assignChunksToDrives } from '../services/storage-engine';
import { createChunkRecords, computeChecksum, splitIntoChunks } from '../services/chunking';
import { getStorageMode } from '../services/storage-mode';
import { getDecryptedTokens, getOAuthClient } from '../utils/drive-auth';

const prisma = new PrismaClient();

export const uploadRoutes = new Hono();

uploadRoutes.post('/init', async (c) => {
  const body = await c.req.json();
  const { name, size_bytes, mime_type, parent_folder_id, total_chunks, chunk_checksums, file_checksum } = body;

  if (!name || !size_bytes || !total_chunks) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } }, 422);
  }

  const userId = (c as any).get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  const storageMode = await getStorageMode(userId);
  const placement = await assignChunksToDrives(userId, size_bytes, storageMode.mode, storageMode.min_replicas);

  if (placement.placement.length === 0 && size_bytes > 0) {
    return c.json({ error: { code: 'INSUFFICIENT_STORAGE', message: 'Not enough storage space available across connected drives' } }, 422);
  }

  const file = await prisma.file.create({
    data: {
      user_id: userId,
      name,
      virtual_path: `/${name}`,
      is_folder: false,
      mime_type,
      size_bytes,
      checksum: file_checksum,
      chunk_count: total_chunks,
      is_chunked: total_chunks > 1,
      redundancy_copies: storageMode.min_replicas,
      parent_id: parent_folder_id || null,
    },
  });

  if (total_chunks > 0 && chunk_checksums) {
    await createChunkRecords(file.id, placement.placement, chunk_checksums);
  }

  return c.json({
    file_id: file.id,
    placement: placement.placement,
    chunk_size: parseInt(process.env.CHUNK_SIZE_BYTES || '52428800'),
  }, 201);
});

uploadRoutes.post('/:fileId/chunk/:chunkIndex', async (c) => {
  const fileId = c.req.param('fileId');
  const chunkIndex = parseInt(c.req.param('chunkIndex'));
  const userId = (c as any).get('userId');

  const file = await prisma.file.findFirst({ where: { id: fileId, user_id: userId } });
  if (!file) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404);
  }

  const chunk = await prisma.chunk.findFirst({
    where: { file_id: fileId, chunk_index: chunkIndex },
    include: { drive: true },
  });

  if (!chunk) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Chunk not found' } }, 404);
  }

  const chunkData = await c.req.arrayBuffer();
  const actualChecksum = await computeChecksum(Buffer.from(chunkData));
  const expectedChecksum = chunk.checksum;

  if (actualChecksum !== expectedChecksum) {
    await prisma.chunk.update({
      where: { file_id_chunk_index: { file_id: fileId, chunk_index: chunkIndex } },
      data: { upload_status: 'failed' },
    });
    return c.json({ error: { code: 'CHECKSUM_MISMATCH', message: 'Chunk checksum does not match' } }, 400);
  }

  const tokens = await getDecryptedTokens(chunk.drive.user_id);
  if (!tokens?.access_token) {
    return c.json({ error: { code: 'DRIVE_OFFLINE', message: 'Target drive is not accessible' } }, 503);
  }

  const oauth2Client = getOAuthClient(chunk.drive.user_id);
  const driveApi = google.drive({ version: 'v3', auth: oauth2Client });

  const fileName = `ekdrive-chunk:${fileId}:${chunkIndex}`;

  await driveApi.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/octet-stream',
      parents: [chunk.drive.root_folder_id],
    },
    media: {
      mimeType: 'application/octet-stream',
      body: Buffer.from(chunkData),
    },
    fields: 'id',
  });

  await prisma.chunk.update({
    where: { file_id_chunk_index: { file_id: fileId, chunk_index: chunkIndex } },
    data: {
      google_file_id: fileName,
      upload_status: 'uploaded',
    },
  });

  const allUploaded = await prisma.chunk.count({
    where: { file_id: fileId, upload_status: 'uploaded' },
  });
  const totalChunks = await prisma.chunk.count({ where: { file_id: fileId } });

  if (allUploaded === totalChunks && totalChunks > 0) {
    await prisma.file.update({
      where: { id: fileId },
      data: { status: 'ready' },
    });
  }

  return c.json({ chunk_index: chunkIndex, status: 'uploaded', progress: allUploaded / totalChunks });
});

uploadRoutes.post('/:fileId/complete', async (c) => {
  const fileId = c.req.param('fileId');
  const userId = (c as any).get('userId');

  const file = await prisma.file.findFirst({ where: { id: fileId, user_id: userId } });
  if (!file) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404);
  }

  await prisma.file.update({
    where: { id: fileId },
    data: { status: 'ready' },
  });

  return c.json({ file_id: fileId, status: 'ready' });
});