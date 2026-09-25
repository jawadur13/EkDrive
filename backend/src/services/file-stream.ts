import type { File } from '@prisma/client';
import { prisma } from '../db/client';
import { HttpError } from '../utils/errors';
import { computeChecksum } from './chunking';
import { downloadChunkFromDrive } from './chunk-store';

export type ByteRange = { start: number; end: number };

// Parses a single "bytes=a-b" / "bytes=a-" / "bytes=-n" range. Returns null when there is
// no usable Range header (serve the whole file) and 'unsatisfiable' when it is out of bounds.
export function parseRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = parseInt(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(parseInt(match[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

// Reassembles a file (or a byte range of it) from its chunks, one chunk in memory at a time.
// Each chunk is checked against its stored checksum; if a copy is unreachable or corrupt the
// next copy is tried.
export async function streamFileContent(file: File, range?: ByteRange | null): Promise<ReadableStream<Uint8Array>> {
  const chunks = await prisma.chunk.findMany({
    where: { file_id: file.id, upload_status: 'uploaded' },
    include: { drive: true },
    orderBy: [{ chunk_index: 'asc' }, { created_at: 'asc' }],
  });

  const byIndex = new Map<number, typeof chunks>();
  for (const chunk of chunks) {
    byIndex.set(chunk.chunk_index, [...(byIndex.get(chunk.chunk_index) ?? []), chunk]);
  }

  // Byte offset of each chunk, from the stored sizes.
  const offsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < file.chunk_count; i++) {
    const copies = byIndex.get(i);
    if (!copies) throw new HttpError(409, 'FILE_INCOMPLETE', `Chunk ${i} has no uploaded copy`);
    offsets.push(offset);
    offset += Number(copies[0].size_bytes);
  }

  let index = 0;
  if (range) {
    while (index + 1 < offsets.length && offsets[index + 1] <= range.start) index++;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= file.chunk_count || (range && offsets[index] > range.end)) {
        controller.close();
        return;
      }
      const replicas = byIndex.get(index)!;
      let lastError: unknown = null;
      for (const replica of replicas) {
        try {
          const data = await downloadChunkFromDrive(replica.drive, replica.google_file_id);
          if ((await computeChecksum(data)) !== replica.checksum) {
            throw new Error(`Checksum mismatch for chunk ${index} on drive ${replica.drive_id}`);
          }
          const from = range ? Math.max(0, range.start - offsets[index]) : 0;
          const to = range ? Math.min(data.byteLength, range.end - offsets[index] + 1) : data.byteLength;
          controller.enqueue(from === 0 && to === data.byteLength ? data : data.subarray(from, to));
          index++;
          return;
        } catch (error) {
          lastError = error;
        }
      }
      console.error(`All copies of chunk ${index} of file ${file.id} failed:`, lastError);
      controller.error(new Error(`Chunk ${index} could not be read from any drive`));
    },
  });
}

// Builds the full response for a file download/preview, honouring a Range header.
export async function fileResponse(c: any, file: File, disposition: 'attachment' | 'inline') {
  const size = Number(file.size_bytes ?? 0);
  const headers = fileResponseHeaders(file, disposition);
  headers['Accept-Ranges'] = 'bytes';

  const range = parseRange(c.req.header('Range'), size);
  if (range === 'unsatisfiable') {
    return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
  }
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
    return c.body(await streamFileContent(file, range), 206, headers);
  }
  return c.body(await streamFileContent(file), 200, headers);
}

export function contentDisposition(name: string, disposition: 'attachment' | 'inline') {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function fileResponseHeaders(file: File, disposition: 'attachment' | 'inline') {
  const headers: Record<string, string> = {
    'Content-Type': disposition === 'inline' ? file.mime_type || 'application/octet-stream' : 'application/octet-stream',
    'Content-Disposition': contentDisposition(file.name, disposition),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  };
  if (file.size_bytes !== null) headers['Content-Length'] = file.size_bytes.toString();
  if (disposition === 'inline') headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";
  return headers;
}
