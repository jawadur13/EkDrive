import { prisma } from '../db/client';

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_BYTES || '52428800');

export type PlacementResult = {
  fileId: string;
  placement: Array<{ chunkIndex: number; driveId: string; chunkSize: number }>;
};

export function selectDriveMaxCapacity(drives: Array<{ id: string; available_quota_bytes: bigint; status: string }>, fileSize: number): string[] {
  const eligible = drives
    .filter((d) => d.status === 'online' && d.available_quota_bytes >= BigInt(fileSize))
    .sort((a, b) => (b.available_quota_bytes > a.available_quota_bytes ? 1 : -1));

  if (eligible.length > 0) {
    return [eligible[0].id];
  }
  return [];
}

export function selectDriveBalanced(drives: Array<{ id: string; used_quota_bytes: bigint; total_quota_bytes: bigint; status: string; available_quota_bytes: bigint }>, fileSize: number, threshold: number = 0.2): string[] {
  const eligible = drives.filter((d) => d.status === 'online');
  if (eligible.length === 0) return [];

  const avgUtil = eligible.reduce((sum, d) => sum + Number(d.used_quota_bytes) / Number(d.total_quota_bytes), 0) / eligible.length;
  const balanced = eligible
    .filter((d) => Number(d.used_quota_bytes) / Number(d.total_quota_bytes) <= avgUtil + threshold)
    .sort((a, b) => (b.available_quota_bytes > a.available_quota_bytes ? 1 : -1));

  if (balanced.length > 0) {
    for (const drive of balanced) {
      if (drive.available_quota_bytes >= BigInt(fileSize)) {
        return [drive.id];
      }
    }
  }
  return [];
}

export function selectDrivesHighReliability(drives: Array<{ id: string; available_quota_bytes: bigint; status: string }>, fileSize: number, minReplicas: number = 2): string[] | null {
  const eligible = drives.filter((d) => d.status === 'online');
  const chunkCount = Math.ceil(fileSize / CHUNK_SIZE);

  for (let i = 0; i < chunkCount; i++) {
    const candidates = eligible.filter((d) => d.available_quota_bytes >= BigInt(CHUNK_SIZE));
    if (candidates.length < minReplicas) {
      return null;
    }
  }

  return eligible.slice(0, Math.min(minReplicas, eligible.length)).map((d) => d.id);
}

export function getChunkSize(): number {
  return CHUNK_SIZE;
}

export async function assignChunksToDrives(
  userId: string,
  fileSize: number,
  mode: string,
  minReplicas: number = 1
): Promise<PlacementResult> {
  const drives = await prisma.drive.findMany({ where: { user_id: userId, status: 'online' } });
  const fileId = 'temp-' + Date.now();

  if (mode === 'max_capacity') {
    const driveIds = selectDriveMaxCapacity(drives, fileSize);
    if (driveIds.length === 0 && fileSize > CHUNK_SIZE) {
      return { fileId, placement: [] };
    }
    return { fileId, placement: [{ chunkIndex: 0, driveId: driveIds[0] || '', chunkSize: fileSize }] };
  }

  if (mode === 'balanced') {
    const driveIds = selectDriveBalanced(drives, fileSize);
    if (driveIds.length === 0 && fileSize > CHUNK_SIZE) {
      return { fileId, placement: [] };
    }
    return { fileId, placement: [{ chunkIndex: 0, driveId: driveIds[0] || '', chunkSize: fileSize }] };
  }

  if (mode === 'high_reliability') {
    const driveIds = selectDrivesHighReliability(drives, fileSize, minReplicas);
    if (!driveIds) {
      return { fileId, placement: [] };
    }
    const placement: Array<{ chunkIndex: number; driveId: string; chunkSize: number }> = [];
    const chunkCount = Math.ceil(fileSize / CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
      placement.push({ chunkIndex: i, driveId: driveIds[i % driveIds.length], chunkSize: Math.min(CHUNK_SIZE, fileSize - i * CHUNK_SIZE) });
    }
    return { fileId, placement };
  }

  return { fileId, placement: [] };
}