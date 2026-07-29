import api from './api';

export function initUpload(file: File, parentFolderId?: string) {
  const chunkSize = 50 * 1024 * 1024;
  const totalChunks = Math.ceil(file.size / chunkSize);
  const chunkChecksums: string[] = [];

  return {
    file,
    chunkSize,
    totalChunks,
    chunkChecksums,
    parentFolderId,
  };
}

export async function uploadChunk(fileId: string, chunkIndex: number, chunkData: Blob) {
  return api.post(`/upload/${fileId}/chunk/${chunkIndex}`, chunkData, {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

export async function completeUpload(fileId: string) {
  return api.post(`/upload/${fileId}/complete`);
}
