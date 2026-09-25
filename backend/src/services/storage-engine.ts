import { env } from '../env';
import { prisma } from '../db/client';
import { WRITABLE_DRIVE_STATUSES } from './drives';
import type { StorageModeName } from './storage-mode';

export type PlacementDrive = {
  id: string;
  total_quota_bytes: bigint | null;
  used_quota_bytes: bigint | null;
  available_quota_bytes: bigint | null;
};

export type ChunkPlacement = { chunkIndex: number; chunkSize: number; driveIds: string[] };

export function getChunkCount(fileSize: number, chunkSize = env.chunkSize) {
  return Math.max(1, Math.ceil(fileSize / chunkSize));
}

export function getReplicaCount(mode: string, minReplicas: number) {
  return mode === 'high_reliability' ? Math.max(2, minReplicas) : 1;
}

// Decides which drive(s) hold each chunk. Space is reserved as chunks are assigned, so a
// file larger than any single drive's free space spreads across drives. Returns null when
// the connected drives cannot hold the file in the requested mode.
export function planPlacement(
  drives: PlacementDrive[],
  fileSize: number,
  mode: StorageModeName,
  minReplicas = 1,
  chunkSize = env.chunkSize
): ChunkPlacement[] | null {
  const state = drives.map((d) => ({
    id: d.id,
    total: d.total_quota_bytes,
    used: d.used_quota_bytes ?? 0n,
    remaining: d.available_quota_bytes ?? 0n,
  }));
  const replicas = getReplicaCount(mode, minReplicas);
  const chunkCount = getChunkCount(fileSize, chunkSize);
  const placement: ChunkPlacement[] = [];

  const utilization = (d: (typeof state)[number], extra: bigint) =>
    d.total && d.total > 0n ? Number(d.used + extra) / Number(d.total) : 0;

  for (let i = 0; i < chunkCount; i++) {
    const size = Math.max(0, Math.min(chunkSize, fileSize - i * chunkSize));
    const bytes = BigInt(size);
    const eligible = state.filter((d) => d.remaining >= bytes);

    if (mode === 'balanced') {
      eligible.sort((a, b) => utilization(a, bytes) - utilization(b, bytes) || (b.remaining > a.remaining ? 1 : -1));
    } else {
      eligible.sort((a, b) => (b.remaining > a.remaining ? 1 : b.remaining < a.remaining ? -1 : 0));
    }

    const chosen = eligible.slice(0, replicas);
    if (chosen.length < replicas) return null;

    for (const d of chosen) {
      d.remaining -= bytes;
      d.used += bytes;
    }
    placement.push({ chunkIndex: i, chunkSize: size, driveIds: chosen.map((d) => d.id) });
  }

  return placement;
}

export async function assignChunksToDrives(userId: string, fileSize: number, mode: StorageModeName, minReplicas = 1) {
  const drives = await prisma.drive.findMany({
    where: { user_id: userId, status: { in: WRITABLE_DRIVE_STATUSES } },
    select: { id: true, total_quota_bytes: true, used_quota_bytes: true, available_quota_bytes: true },
  });
  return planPlacement(drives, fileSize, mode, minReplicas);
}
