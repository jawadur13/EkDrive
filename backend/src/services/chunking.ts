import xxhash from 'xxhash-wasm';
import { prisma } from '../db/client';
import type { ChunkPlacement } from './storage-engine';

let hasherPromise: ReturnType<typeof xxhash> | null = null;

// xxhash64 as unpadded lowercase hex. The frontend computes the same value with the same
// library, so the two must stay in step.
export async function computeChecksum(data: Uint8Array): Promise<string> {
  hasherPromise ??= xxhash();
  const hasher = await hasherPromise;
  return hasher.h64Raw(data).toString(16);
}

// One record per (chunk, drive) — a chunk with replicas has several.
export async function createChunkRecords(fileId: string, placement: ChunkPlacement[]) {
  await prisma.chunk.createMany({
    data: placement.flatMap((p) =>
      p.driveIds.map((driveId) => ({
        file_id: fileId,
        drive_id: driveId,
        chunk_index: p.chunkIndex,
        size_bytes: BigInt(p.chunkSize),
        google_file_id: '',
        upload_status: 'pending',
      }))
    ),
  });
}
