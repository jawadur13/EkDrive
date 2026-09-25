import { env } from '../env';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { prisma } from '../db/client';
import { parseBody } from '../middleware/validation';
import { assignChunksToDrives, getChunkCount, getReplicaCount } from '../services/storage-engine';
import { computeChecksum, createChunkRecords } from '../services/chunking';
import { uploadChunkToDrive } from '../services/chunk-store';
import { adjustDriveUsage } from '../services/drives';
import { buildVirtualPath, FILE_STATUS, removeFiles, resolveParentFolder, validateName } from '../services/files';
import { getStorageMode } from '../services/storage-mode';
import { HttpError, notFound } from '../utils/errors';
import { logActivity } from '../services/activity';

export const uploadRoutes = new Hono();

const initSchema = z.object({
  name: z.string().min(1).max(1024),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  mimeType: z.string().max(255).optional(),
  parentFolderId: z.string().uuid().nullish(),
});

const completeSchema = z.object({ checksum: z.string().max(64).optional() }).nullish();

async function getUploadingFile(userId: string, fileId: string) {
  const file = await prisma.file.findFirst({ where: { id: fileId, user_id: userId } });
  if (!file) throw notFound('File');
  if (file.status !== FILE_STATUS.uploading) throw new HttpError(409, 'ALREADY_COMPLETE', 'Upload already completed');
  return file;
}

uploadRoutes.post('/init', async (c) => {
  const userId = (c as any).get('userId') as string;
  const body = await parseBody(c, initSchema);
  const name = validateName(body.name);
  const parent = await resolveParentFolder(userId, body.parentFolderId);

  const storageMode = await getStorageMode(userId);
  const placement = await assignChunksToDrives(userId, body.sizeBytes, storageMode.mode as any, storageMode.min_replicas);
  if (!placement) {
    return c.json({ error: { code: 'INSUFFICIENT_STORAGE', message: 'Not enough space across connected drives for this file in the current storage mode' } }, 507);
  }

  const chunkCount = getChunkCount(body.sizeBytes);
  const file = await prisma.file.create({
    data: {
      user_id: userId,
      parent_id: parent?.id ?? null,
      name,
      virtual_path: buildVirtualPath(parent, name),
      mime_type: body.mimeType || 'application/octet-stream',
      size_bytes: BigInt(body.sizeBytes),
      chunk_count: chunkCount,
      is_chunked: chunkCount > 1,
      redundancy_copies: getReplicaCount(storageMode.mode, storageMode.min_replicas),
      status: FILE_STATUS.uploading,
    },
  });
  await createChunkRecords(file.id, placement);

  return c.json({ fileId: file.id, chunkSize: env.chunkSize, chunkCount }, 201);
});

// Body: raw chunk bytes. Header x-chunk-checksum: xxhash64 hex computed by the client.
// Safe to retry: copies already stored are skipped.
uploadRoutes.post(
  '/:fileId{[0-9a-fA-F-]{36}}/chunk/:chunkIndex{[0-9]+}',
  bodyLimit({
    maxSize: env.chunkSize + 1024,
    onError: (c) => c.json({ error: { code: 'CHUNK_TOO_LARGE', message: 'Chunk exceeds the configured chunk size' } }, 413),
  }),
  async (c) => {
    const userId = (c as any).get('userId') as string;
    const file = await getUploadingFile(userId, c.req.param('fileId'));
    const chunkIndex = parseInt(c.req.param('chunkIndex'));

    const replicas = await prisma.chunk.findMany({
      where: { file_id: file.id, chunk_index: chunkIndex },
      include: { drive: true },
    });
    if (replicas.length === 0) throw notFound('Chunk');

    const data = new Uint8Array(await c.req.arrayBuffer());
    if (BigInt(data.byteLength) !== replicas[0].size_bytes) {
      throw new HttpError(400, 'SIZE_MISMATCH', `Chunk ${chunkIndex} must be ${replicas[0].size_bytes} bytes`);
    }

    const checksum = await computeChecksum(data);
    const claimed = c.req.header('x-chunk-checksum');
    if (!claimed || claimed.toLowerCase() !== checksum) {
      throw new HttpError(400, 'CHECKSUM_MISMATCH', 'Chunk checksum does not match its contents');
    }

    const failures: string[] = [];
    for (const replica of replicas) {
      if (replica.upload_status === 'uploaded') continue;
      try {
        const googleFileId = await uploadChunkToDrive(replica.drive, `ekdrive-${file.id}-${chunkIndex}`, data);
        await prisma.chunk.update({
          where: { id: replica.id },
          data: { google_file_id: googleFileId, checksum, upload_status: 'uploaded', updated_at: new Date() },
        });
        await adjustDriveUsage(replica.drive_id, replica.size_bytes);
      } catch (error) {
        console.error(`Uploading chunk ${chunkIndex} of ${file.id} to drive ${replica.drive_id} failed:`, error);
        await prisma.chunk.update({ where: { id: replica.id }, data: { upload_status: 'failed', updated_at: new Date() } });
        failures.push(replica.drive_id);
      }
    }

    if (failures.length > 0) {
      return c.json({ error: { code: 'DRIVE_ERROR', message: `Could not store chunk on ${failures.length} drive(s); retry the chunk` } }, 502);
    }

    const [uploaded, total] = await Promise.all([
      prisma.chunk.count({ where: { file_id: file.id, upload_status: 'uploaded' } }),
      prisma.chunk.count({ where: { file_id: file.id } }),
    ]);
    return c.json({ chunkIndex, status: 'uploaded', progress: uploaded / total });
  }
);

uploadRoutes.post('/:fileId{[0-9a-fA-F-]{36}}/complete', async (c) => {
  const userId = (c as any).get('userId') as string;
  const file = await getUploadingFile(userId, c.req.param('fileId'));
  const body = await parseBody(c, completeSchema);

  const pending = await prisma.chunk.count({ where: { file_id: file.id, upload_status: { not: 'uploaded' } } });
  if (pending > 0) {
    throw new HttpError(409, 'CHUNKS_PENDING', `${pending} chunk copies are not uploaded yet`);
  }

  const updated = await prisma.file.update({
    where: { id: file.id },
    data: { status: FILE_STATUS.ready, checksum: body?.checksum, updated_at: new Date() },
  });
  await logActivity(userId, 'file.uploaded', updated, { sizeBytes: updated.size_bytes?.toString(), copies: updated.redundancy_copies });
  return c.json(updated);
});

uploadRoutes.delete('/:fileId{[0-9a-fA-F-]{36}}', async (c) => {
  const userId = (c as any).get('userId') as string;
  const file = await getUploadingFile(userId, c.req.param('fileId'));
  await removeFiles([file.id]);
  return c.json({ id: file.id, message: 'Upload aborted' });
});
