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
  const formData = new FormData();
  formData.append('chunk', chunkData);

  return api.post(`/api/v1/upload/${fileId}/chunk/${chunkIndex}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function completeUpload(fileId: string) {
  return api.post(`/api/v1/upload/${fileId}/complete`);
}