import axios from 'axios';
import xxhash from 'xxhash-wasm';
import api from './api';

let hasherPromise: ReturnType<typeof xxhash> | null = null;
const getHasher = () => (hasherPromise ??= xxhash());

// Must match computeChecksum in backend/src/services/chunking.ts: xxhash64, unpadded hex.
async function checksum(data: Uint8Array) {
  return (await getHasher()).h64Raw(data).toString(16);
}

const MAX_ATTEMPTS = 3;
const CONCURRENCY = 4;
const RESUME_PREFIX = 'ekdrive.upload.';
/** An unfinished upload is worth resuming for a day; the server cleans it up after that. */
const RESUME_TTL_MS = 24 * 60 * 60 * 1000;

type InitResponse = { fileId: string; chunkSize: number; chunkCount: number };

// Identifies the same file picked again after a reload. Not a content hash: hashing a large
// file up front would cost more than re-uploading the few chunks this might get wrong.
function resumeKey(file: File, parentFolderId: string | null) {
  return `${RESUME_PREFIX}${parentFolderId ?? 'root'}:${file.name}:${file.size}:${file.lastModified}`;
}

function readResume(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { fileId, savedAt } = JSON.parse(raw) as { fileId: string; savedAt: number };
    if (Date.now() - savedAt > RESUME_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return fileId;
  } catch {
    return null;
  }
}

function writeResume(key: string, fileId: string) {
  try {
    localStorage.setItem(key, JSON.stringify({ fileId, savedAt: Date.now() }));
  } catch {
    // Private mode or a full quota: resuming is a convenience, not a requirement.
  }
}

function clearResume(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

// Retries network errors, 5xx and 429 (a drive being throttled); 4xx means the request itself
// is wrong and retrying cannot help.
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (signal?.aborted) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const retryable = status === undefined || status >= 500 || status === 429;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
}

async function startOrResume(file: File, parentFolderId: string | null, key: string) {
  const existingId = readResume(key);
  if (existingId) {
    try {
      const status = await api.get(`/upload/${existingId}/status`);
      if (status.data.status === 'uploading' && status.data.chunkCount > 0) {
        return {
          init: { fileId: existingId, chunkSize: status.data.chunkSize, chunkCount: status.data.chunkCount } as InitResponse,
          todo: status.data.missingChunks as number[],
          resumedFrom: (status.data.uploadedChunks as number[]).length,
        };
      }
    } catch {
      // Gone, finished or not ours any more: start fresh.
    }
    clearResume(key);
  }

  const res = await api.post('/upload/init', {
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type || undefined,
    parentFolderId,
  });
  const init = res.data as InitResponse;
  writeResume(key, init.fileId);
  return { init, todo: Array.from({ length: init.chunkCount }, (_, i) => i), resumedFrom: 0 };
}

export async function uploadFile(
  file: File,
  parentFolderId: string | null,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal
) {
  const key = resumeKey(file, parentFolderId);
  const { init, todo, resumedFrom } = await startOrResume(file, parentFolderId, key);
  const { fileId, chunkSize, chunkCount } = init;

  // Bytes already on the server, plus the bytes of each chunk this run has finished.
  let settledBytes = Math.min(resumedFrom * chunkSize, file.size);
  const inFlight = new Map<number, number>();
  const report = () => {
    const live = [...inFlight.values()].reduce((sum, n) => sum + n, 0);
    onProgress(Math.min(settledBytes + live, file.size), file.size);
  };
  report();

  try {
    const queue = [...todo];
    // Several chunks at once: one request per chunk never saturates a connection, and the
    // backend forwards each one to a different Google account anyway.
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const index = queue.shift();
        if (index === undefined) return;
        if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

        const blob = file.slice(index * chunkSize, (index + 1) * chunkSize);
        const data = new Uint8Array(await blob.arrayBuffer());
        const sum = await checksum(data);

        await withRetry(
          () =>
            api.post(`/upload/${fileId}/chunk/${index}`, data, {
              headers: { 'Content-Type': 'application/octet-stream', 'x-chunk-checksum': sum },
              signal,
              onUploadProgress: (e) => {
                inFlight.set(index, e.loaded ?? 0);
                report();
              },
            }),
          signal
        );

        inFlight.delete(index);
        settledBytes += data.byteLength;
        report();
      }
    });
    await Promise.all(workers);

    // The whole-file hash has to be computed in order, so it happens once the parts are in.
    const fileHasher = (await getHasher()).create64();
    for (let index = 0; index < chunkCount; index++) {
      fileHasher.update(new Uint8Array(await file.slice(index * chunkSize, (index + 1) * chunkSize).arrayBuffer()));
    }

    const complete = await api.post(`/upload/${fileId}/complete`, { checksum: fileHasher.digest().toString(16) });
    clearResume(key);
    return complete.data;
  } catch (error) {
    // A cancel or a reload keeps the stored chunks so the next attempt can resume; anything
    // else is a dead upload, so free the space it reserved.
    if (!signal?.aborted) {
      await api.delete(`/upload/${fileId}`).catch(() => {});
      clearResume(key);
    }
    throw error;
  }
}
