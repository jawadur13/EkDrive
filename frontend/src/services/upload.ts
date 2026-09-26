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

// Retries network errors and 5xx (e.g. a drive briefly failing); 4xx means the request is wrong.
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const retryable = !signal?.aborted && (status === undefined || status >= 500);
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
}

export async function uploadFile(
  file: File,
  parentFolderId: string | null,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal
) {
  const init = await api.post('/upload/init', {
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type || undefined,
    parentFolderId,
  });
  const { fileId, chunkSize, chunkCount } = init.data as { fileId: string; chunkSize: number; chunkCount: number };

  try {
    const fileHasher = (await getHasher()).create64();
    let uploaded = 0;

    for (let index = 0; index < chunkCount; index++) {
      const data = new Uint8Array(await file.slice(index * chunkSize, (index + 1) * chunkSize).arrayBuffer());
      const sum = await checksum(data);
      fileHasher.update(data);

      await withRetry(
        () =>
          api.post(`/upload/${fileId}/chunk/${index}`, data, {
            headers: { 'Content-Type': 'application/octet-stream', 'x-chunk-checksum': sum },
            signal,
            onUploadProgress: (e) => onProgress(uploaded + (e.loaded ?? 0), file.size),
          }),
        signal
      );
      uploaded += data.byteLength;
      onProgress(uploaded, file.size);
    }

    const complete = await api.post(`/upload/${fileId}/complete`, { checksum: fileHasher.digest().toString(16) });
    return complete.data;
  } catch (error) {
    // Free the reserved chunks; the backend cleanup job catches anything this misses.
    await api.delete(`/upload/${fileId}`).catch(() => {});
    throw error;
  }
}
