import { prisma } from '../db/client';

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_BYTES || '52428800');

const NULL_BIGINT = BigInt(0);

export type PlacementResult = {
  fileId: string;
  placement: Array<{ chunkIndex: number; driveId: string; chunkSize: number }>;
};

function toBigInt(val: bigint | null): bigint {
  return val || NULL_BIGINT;
}

export function selectDriveMaxCapacity(drives: Array<{ id: string; available_quota_bytes: bigint | null; status: string }>, fileSize: number, chunkCount: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const eligible = drives
      .filter((d) => d.status === 'online' && toBigInt(d.available_quota_bytes) >= BigInt(Math.min(CHUNK_SIZE, fileSize - i * CHUNK_SIZE)))
      .sort((a, b) => (toBigInt(b.available_quota_bytes) > toBigInt(a.available_quota_bytes) ? 1 : -1));

    if (eligible.length === 0) return [];
    result.push(eligible[0].id);
  }
  return result;
}

export function selectDriveBalanced(drives: Array<{ id: string; used_quota_bytes: bigint | null; total_quota_bytes: bigint | null; status: string; available_quota_bytes: bigint | null }>, fileSize: number, threshold: number = 0.2): string[] {
  const eligible = drives.filter((d) => d.status === 'online');
  if (eligible.length === 0) return [];

  const chunkCount = Math.ceil(fileSize / CHUNK_SIZE);
  const avgUtil = eligible.reduce((sum, d) => {
    const used = toBigInt(d.used_quota_bytes);
    const total = toBigInt(d.total_quota_bytes);
    return sum + (total > NULL_BIGINT ? Number(used) / Number(total) : 0);
  }, 0) / eligible.length;

  const result: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const balanced = eligible
      .filter((d) => {
        const used = toBigInt(d.used_quota_bytes);
        const total = toBigInt(d.total_quota_bytes);
        const avail = toBigInt(d.available_quota_bytes);
        const util = total > NULL_BIGINT ? Number(used) / Number(total) : 0;
        return util <= avgUtil + threshold && avail >= BigInt(Math.min(CHUNK_SIZE, fileSize - i * CHUNK_SIZE));
      })
      .sort((a, b) => (toBigInt(b.available_quota_bytes) > toBigInt(a.available_quota_bytes) ? 1 : -1));

    if (balanced.length === 0) return [];
    result.push(balanced[0].id);
  }
  return result;
}

export function selectDrivesHighReliability(drives: Array<{ id: string; available_quota_bytes: bigint | null; status: string }>, fileSize: number, minReplicas: number = 2): string[] | null {
  const eligible = drives.filter((d) => d.status === 'online');
  const chunkCount = Math.ceil(fileSize / CHUNK_SIZE);

  for (let i = 0; i < chunkCount; i++) {
    const candidates = eligible.filter((d) => toBigInt(d.available_quota_bytes) >= BigInt(CHUNK_SIZE));
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
  const chunkCount = Math.ceil(fileSize / CHUNK_SIZE);

  if (mode === 'max_capacity') {
    const driveIds = selectDriveMaxCapacity(drives, fileSize, chunkCount);
    if (driveIds.length === 0) {
      return { fileId, placement: [] };
    }
    const placement: Array<{ chunkIndex: number; driveId: string; chunkSize: number }> = [];
    for (let i = 0; i < chunkCount; i++) {
      placement.push({ chunkIndex: i, driveId: driveIds[i], chunkSize: Math.min(CHUNK_SIZE, fileSize - i * CHUNK_SIZE) });
    }
    return { fileId, placement };
  }

  if (mode === 'balanced') {
    const driveIds = selectDriveBalanced(drives, fileSize);
    if (driveIds.length === 0) {
      return { fileId, placement: [] };
    }
    const placement: Array<{ chunkIndex: number; driveId: string; chunkSize: number }> = [];
    for (let i = 0; i < chunkCount; i++) {
      placement.push({ chunkIndex: i, driveId: driveIds[i], chunkSize: Math.min(CHUNK_SIZE, fileSize - i * CHUNK_SIZE) });
    }
    return { fileId, placement };
  }

  if (mode === 'high_reliability') {
    const driveIds = selectDrivesHighReliability(drives, fileSize, minReplicas);
    if (!driveIds) {
      return { fileId, placement: [] };
    }
    const placement: Array<{ chunkIndex: number; driveId: string; chunkSize: number }> = [];
    for (let i = 0; i < chunkCount; i++) {
      placement.push({ chunkIndex: i, driveId: driveIds[i % driveIds.length], chunkSize: Math.min(CHUNK_SIZE, fileSize - i * CHUNK_SIZE) });
    }
    return { fileId, placement };
  }

  return { fileId, placement: [] };
}
