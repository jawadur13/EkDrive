import { prisma } from '../db/client';

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_BYTES || '52428800');

export async function computeChecksum(data: Buffer): Promise<string> {
  const xxhash = await import('xxhash-wasm');
  const hasher = await xxhash.default();
  const raw = hasher.h64Raw(new Uint8Array(data));
  return raw.toString(16);
}

export function getChunkSize(): number {
  return CHUNK_SIZE;
}

export function splitIntoChunks(fileSize: number): Array<{ index: number; size: number }> {
  const chunks: Array<{ index: number; size: number }> = [];
  let offset = 0;
  let index = 0;

  while (offset < fileSize) {
    const size = Math.min(CHUNK_SIZE, fileSize - offset);
    chunks.push({ index, size });
    offset += size;
    index++;
  }

  return chunks;
}

export async function verifyChunkChecksum(chunkData: Buffer, expectedChecksum: string): Promise<boolean> {
  const actual = await computeChecksum(chunkData);
  return actual === expectedChecksum;
}

export async function verifyFileChecksum(chunks: Buffer[], expectedChecksum: string): Promise<boolean> {
  const combined = Buffer.concat(chunks);
  const actual = await computeChecksum(combined);
  return actual === expectedChecksum;
}

export async function createChunkRecords(fileId: string, placement: Array<{ chunkIndex: number; driveId: string; chunkSize: number }>, checksums: string[]): Promise<void> {
  const chunkRecords = placement.map((p) => ({
    file_id: fileId,
    drive_id: p.driveId,
    chunk_index: p.chunkIndex,
    size_bytes: p.chunkSize,
    checksum: checksums[p.chunkIndex] || '',
    google_file_id: '',
    upload_status: 'pending' as const,
  }));

  await prisma.chunk.createMany({ data: chunkRecords as any });
}
