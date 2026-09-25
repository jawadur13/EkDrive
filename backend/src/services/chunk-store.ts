import { Readable } from 'node:stream';
import type { Drive } from '@prisma/client';
import { getDriveApi } from '../utils/drive-auth';

// Raw chunk I/O against a single Google Drive account.

export async function uploadChunkToDrive(drive: Drive, name: string, data: Uint8Array) {
  const response = await getDriveApi(drive).files.create({
    requestBody: { name, mimeType: 'application/octet-stream', parents: [drive.root_folder_id] },
    media: { mimeType: 'application/octet-stream', body: Readable.from(Buffer.from(data)) },
    fields: 'id',
  });
  if (!response.data.id) throw new Error('Google Drive did not return a file id');
  return response.data.id;
}

export async function downloadChunkFromDrive(drive: Drive, googleFileId: string) {
  const response = await getDriveApi(drive).files.get(
    { fileId: googleFileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return new Uint8Array(response.data as ArrayBuffer);
}

export async function deleteChunkFromDrive(drive: Drive, googleFileId: string) {
  try {
    await getDriveApi(drive).files.delete({ fileId: googleFileId });
  } catch (error: any) {
    // Already gone is fine.
    if (error?.code !== 404 && error?.response?.status !== 404) throw error;
  }
}
