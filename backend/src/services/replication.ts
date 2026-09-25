import type { Chunk, Drive } from '@prisma/client';
import { prisma } from '../db/client';
import { computeChecksum } from './chunking';
import { deleteChunkFromDrive, downloadChunkFromDrive, uploadChunkToDrive } from './chunk-store';
import { adjustDriveUsage, WRITABLE_DRIVE_STATUSES } from './drives';
import { FILE_STATUS } from './files';
import { getReplicaCount } from './storage-engine';
import { getStorageMode } from './storage-mode';

type ChunkWithDrive = Chunk & { drive: Drive };

async function readVerified(copies: ChunkWithDrive[]) {
  for (const copy of copies) {
    try {
      const data = await downloadChunkFromDrive(copy.drive, copy.google_file_id);
      if ((await computeChecksum(data)) === copy.checksum) return data;
    } catch {
      // Try the next copy.
    }
  }
  return null;
}

async function writableDrives(userId: string) {
  return prisma.drive.findMany({ where: { user_id: userId, status: { in: WRITABLE_DRIVE_STATUSES } } });
}

function pickTargets(drives: Drive[], exclude: Set<string>, size: bigint, count: number) {
  return drives
    .filter((d) => !exclude.has(d.id) && (d.available_quota_bytes ?? 0n) >= size)
    .sort((a, b) => ((b.available_quota_bytes ?? 0n) > (a.available_quota_bytes ?? 0n) ? 1 : -1))
    .slice(0, count);
}

async function storeCopy(fileId: string, index: number, target: Drive, data: Uint8Array, checksum: string, size: bigint) {
  const googleFileId = await uploadChunkToDrive(target, `ekdrive-${fileId}-${index}`, data);
  await prisma.chunk.create({
    data: {
      file_id: fileId,
      drive_id: target.id,
      chunk_index: index,
      size_bytes: size,
      checksum,
      google_file_id: googleFileId,
      upload_status: 'uploaded',
    },
  });
  await adjustDriveUsage(target.id, size);
  target.available_quota_bytes = (target.available_quota_bytes ?? 0n) - size;
  target.used_quota_bytes = (target.used_quota_bytes ?? 0n) + size;
}

async function dropCopy(copy: Chunk & { drive: Drive }) {
  if (copy.google_file_id) await deleteChunkFromDrive(copy.drive, copy.google_file_id).catch(() => {});
  await prisma.chunk.delete({ where: { id: copy.id } });
  if (copy.upload_status === 'uploaded') await adjustDriveUsage(copy.drive_id, -copy.size_bytes);
}

export type RepairResult = { fileId: string; copiesAdded: number; copiesRemoved: number; lostChunks: number[] };

// Brings every chunk of a file to exactly `redundancy_copies` healthy copies: stale records
// (missing/failed) are dropped, missing copies are rebuilt from a healthy one, and extra
// copies beyond the target are removed. Chunks with no readable copy are reported as lost.
export async function repairFile(fileId: string): Promise<RepairResult> {
  const result: RepairResult = { fileId, copiesAdded: 0, copiesRemoved: 0, lostChunks: [] };
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file || file.is_folder || file.status !== FILE_STATUS.ready) return result;

  const chunks = await prisma.chunk.findMany({ where: { file_id: fileId }, include: { drive: true } });
  const drives = await writableDrives(file.user_id);
  const desired = file.redundancy_copies;

  for (let index = 0; index < file.chunk_count; index++) {
    const copies = chunks.filter((c) => c.chunk_index === index);
    const healthy = copies.filter((c) => c.upload_status === 'uploaded');
    for (const stale of copies.filter((c) => c.upload_status !== 'uploaded')) {
      await dropCopy(stale);
    }

    if (healthy.length === 0) {
      result.lostChunks.push(index);
      continue;
    }

    if (healthy.length > desired) {
      // Keep the copies on the drives with the most free space.
      const byFreeSpace = [...healthy].sort((a, b) =>
        (b.drive.available_quota_bytes ?? 0n) > (a.drive.available_quota_bytes ?? 0n) ? 1 : -1
      );
      for (const extra of byFreeSpace.slice(desired)) {
        await dropCopy(extra);
        result.copiesRemoved++;
      }
      continue;
    }

    const needed = desired - healthy.length;
    if (needed === 0) continue;

    const size = healthy[0].size_bytes;
    const targets = pickTargets(drives, new Set(healthy.map((c) => c.drive_id)), size, needed);
    if (targets.length === 0) continue;

    const data = await readVerified(healthy);
    if (!data) {
      result.lostChunks.push(index);
      continue;
    }
    for (const target of targets) {
      await storeCopy(fileId, index, target, data, healthy[0].checksum, size);
      result.copiesAdded++;
    }
  }

  return result;
}

// Moves one chunk copy to another drive (copy first, then delete the original).
async function moveCopy(copy: ChunkWithDrive, target: Drive) {
  const data = await readVerified([copy]);
  if (!data) return false;
  await storeCopy(copy.file_id, copy.chunk_index, target, data, copy.checksum, copy.size_bytes);
  await dropCopy(copy);
  return true;
}

export type RebalanceResult = { filesAdjusted: number; copiesAdded: number; copiesRemoved: number; chunksMoved: number; lostChunks: number };

const MAX_MOVES_PER_RUN = 200;

// Applies the current storage mode to files uploaded under a different one: sets each file's
// copy count to the mode's, then (in balanced mode) moves chunks from the most to the least
// utilized drive until their utilization is within the mode's threshold.
export async function rebalanceUser(userId: string): Promise<RebalanceResult> {
  const result: RebalanceResult = { filesAdjusted: 0, copiesAdded: 0, copiesRemoved: 0, chunksMoved: 0, lostChunks: 0 };
  const mode = await getStorageMode(userId);
  const desired = getReplicaCount(mode.mode, mode.min_replicas);

  const files = await prisma.file.findMany({
    where: { user_id: userId, is_folder: false, status: FILE_STATUS.ready, redundancy_copies: { not: desired } },
    select: { id: true },
  });
  for (const { id } of files) {
    await prisma.file.update({ where: { id }, data: { redundancy_copies: desired } });
    const repair = await repairFile(id);
    result.filesAdjusted++;
    result.copiesAdded += repair.copiesAdded;
    result.copiesRemoved += repair.copiesRemoved;
    result.lostChunks += repair.lostChunks.length;
  }

  if (mode.mode !== 'balanced') return result;

  const drives = (await writableDrives(userId)).filter((d) => d.total_quota_bytes && d.total_quota_bytes > 0n);
  const utilization = (d: Drive) => Number(d.used_quota_bytes ?? 0n) / Number(d.total_quota_bytes!);

  while (drives.length > 1 && result.chunksMoved < MAX_MOVES_PER_RUN) {
    drives.sort((a, b) => utilization(b) - utilization(a));
    const source = drives[0];
    const target = drives[drives.length - 1];
    if (utilization(source) - utilization(target) <= mode.rebalance_threshold) break;

    // A copy on the source whose chunk has no copy on the target yet, and that fits.
    const candidates = await prisma.chunk.findMany({
      where: {
        drive_id: source.id,
        upload_status: 'uploaded',
        size_bytes: { lte: target.available_quota_bytes ?? 0n },
        file: { status: FILE_STATUS.ready },
      },
      include: { drive: true },
      orderBy: { size_bytes: 'desc' },
      take: 20,
    });
    let moved = false;
    for (const candidate of candidates) {
      const clash = await prisma.chunk.count({
        where: { file_id: candidate.file_id, chunk_index: candidate.chunk_index, drive_id: target.id },
      });
      if (clash > 0) continue;
      if (await moveCopy(candidate, target)) {
        source.used_quota_bytes = (source.used_quota_bytes ?? 0n) - candidate.size_bytes;
        source.available_quota_bytes = (source.available_quota_bytes ?? 0n) + candidate.size_bytes;
        result.chunksMoved++;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }

  return result;
}

// One rebalance per user at a time, in this process.
const running = new Set<string>();

export function isRebalancing(userId: string) {
  return running.has(userId);
}

export async function runExclusiveRebalance(userId: string) {
  if (running.has(userId)) return null;
  running.add(userId);
  try {
    return await rebalanceUser(userId);
  } finally {
    running.delete(userId);
  }
}
