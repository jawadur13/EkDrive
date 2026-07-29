import api from './api';

export function getDownloadUrl(fileId: string) {
  return `/files/${fileId}/download`;
}

export async function getFileInfo(fileId: string) {
  return api.get(`/files/${fileId}`).then((r) => r.data);
}

export async function getChunkInfo(fileId: string, chunkIndex: number) {
  return api.get(`/files/${fileId}/chunk/${chunkIndex}`).then((r) => r.data);
}
