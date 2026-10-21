import { env } from '../env';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Chunk, Drive } from '@prisma/client';
import { prisma } from '../db/client';
import { parseBody } from '../middleware/validation';
import { assignChunksToDrives, getChunkCount, getReplicaCount } from '../services/storage-engine';
import { computeChecksum, createChunkRecords } from '../services/chunking';
import { uploadChunkToDrive } from '../services/chunk-store';
import { adjustDriveUsage, findFallbackDrive } from '../services/drives';
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

  if (body.sizeBytes > env.maxFileSize) {
    throw new HttpError(413, 'FILE_TOO_LARGE', `Files are limited to ${env.maxFileSize} bytes`);
  }

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

  return c.json(
    {
      fileId: file.id,
      chunkSize: env.chunkSize,
      chunkCount,
      // Where each chunk is headed, so the client can show the spread before it starts.
      placement: placement.map((p) => ({ chunkIndex: p.chunkIndex, chunkSize: p.chunkSize, driveIds: p.driveIds })),
    },
    201
  );
});

// Which chunks are already stored. The client calls this when it resumes an upload it
// started earlier, so it only sends what is still missing.
uploadRoutes.get('/:fileId{[0-9a-fA-F-]{36}}/status', async (c) => {
  const userId = (c as any).get('userId') as string;
  const fileId = c.req.param('fileId');
  const file = await prisma.file.findFirst({ where: { id: fileId, user_id: userId } });
  if (!file) throw notFound('File');

  const chunks = await prisma.chunk.findMany({
    where: { file_id: file.id },
    select: { chunk_index: true, upload_status: true },
  });

  const done = new Set<number>();
  const pending = new Set<number>();
  for (const chunk of chunks) {
    (chunk.upload_status === 'uploaded' ? done : pending).add(chunk.chunk_index);
  }
  // A chunk counts as complete only when every copy of it is stored.
  const uploaded = [...done].filter((index) => !pending.has(index)).sort((a, b) => a - b);
  const missing = Array.from({ length: file.chunk_count }, (_, i) => i).filter((i) => !uploaded.includes(i));

  return c.json({
    fileId: file.id,
    name: file.name,
    status: file.status,
    sizeBytes: file.size_bytes,
    chunkSize: env.chunkSize,
    chunkCount: file.chunk_count,
    uploadedChunks: uploaded,
    missingChunks: missing,
  });
});

type ChunkWithDrive = Chunk & { drive: Drive };

// Stores one copy. If its drive refuses the write, the copy moves to another drive that has
// room, so one bad account does not fail the upload.
async function storeReplica(fileId: string, chunkIndex: number, replica: ChunkWithDrive, data: Uint8Array, checksum: string, userId: string, taken: string[]) {
  const attempt = async (drive: Drive) => {
    const googleFileId = await uploadChunkToDrive(drive, `ekdrive-${fileId}-${chunkIndex}`, data);
    await prisma.chunk.update({
      where: { id: replica.id },
      data: { drive_id: drive.id, google_file_id: googleFileId, checksum, upload_status: 'uploaded', updated_at: new Date() },
    });
    await adjustDriveUsage(drive.id, replica.size_bytes);
    return drive.id;
  };

  try {
    return await attempt(replica.drive);
  } catch (error) {
    console.warn(`Chunk ${chunkIndex} of ${fileId} could not be stored on drive ${replica.drive_id}:`, error);
  }

  // The drive that just refused is excluded too, or the fallback picks it straight back.
  const fallback = await findFallbackDrive(userId, [...taken, replica.drive_id], replica.size_bytes);
  if (!fallback) {
    await prisma.chunk.update({ where: { id: replica.id }, data: { upload_status: 'failed', updated_at: new Date() } });
    return null;
  }

  try {
    const driveId = await attempt(fallback);
    console.log(`Chunk ${chunkIndex} of ${fileId} moved to drive ${driveId} after a failure`);
    return driveId;
  } catch (error) {
    console.error(`Fallback drive ${fallback.id} also refused chunk ${chunkIndex} of ${fileId}:`, error);
    await prisma.chunk.update({ where: { id: replica.id }, data: { upload_status: 'failed', updated_at: new Date() } });
    return null;
  }
}

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

    // Copies of one chunk must live on different drives, including after a fallback.
    const taken = replicas.filter((r) => r.upload_status === 'uploaded').map((r) => r.drive_id);
    let failures = 0;
    for (const replica of replicas) {
      if (replica.upload_status === 'uploaded') continue;
      const driveId = await storeReplica(file.id, chunkIndex, replica, data, checksum, userId, [
        ...taken,
        ...replicas.filter((r) => r.id !== replica.id).map((r) => r.drive_id),
      ]);
      if (driveId) taken.push(driveId);
      else failures++;
    }

    if (failures > 0) {
      return c.json({ error: { code: 'DRIVE_ERROR', message: `Could not store chunk on ${failures} drive(s); retry the chunk` } }, 502);
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
