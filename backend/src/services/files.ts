import { prisma } from '../db/client';
import { google } from 'googleapis';
import { createAuthenticatedDriveClient } from '../utils/drive-auth';

export async function listFiles(userId: string, parentFolderId: string | null, cursor: string | null, limit: number = 50) {
  const files = await prisma.file.findMany({
    where: { user_id: userId, parent_id: parentFolderId },
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { is_folder: 'desc', created_at: 'desc' },
  });

  const hasMore = files.length > limit;
  if (hasMore) files.pop();

  return {
    files,
    pagination: {
      nextCursor: hasMore ? files[files.length - 1]?.id ?? null : null,
      hasMore,
      totalCount: await prisma.file.count({ where: { user_id: userId, parent_id: parentFolderId } }),
    },
  };
}

export async function getFileById(userId: string, fileId: string) {
  return prisma.file.findFirst({ where: { id: fileId, user_id: userId } });
}

export async function createFolder(userId: string, name: string, parentFolderId: string | null, driveId: string) {
  const drive = await prisma.drive.findUnique({ where: { id: driveId } });
  if (!drive) throw new Error('Drive not found');

  const { client, tokens } = await createAuthenticatedDriveClient(drive.user_id);
  if (!tokens?.access_token) throw new Error('No access token');

  const driveApi = google.drive({ version: 'v3', auth: client as any });

  const folder = await driveApi.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [drive.root_folder_id],
    },
    fields: 'id, name, mimeType',
  });

  return prisma.file.create({
    data: {
      user_id: userId,
      parent_id: parentFolderId,
      name,
      virtual_path: `/${name}`,
      is_folder: true,
      mime_type: 'application/vnd.google-apps.folder',
      google_file_ids: [folder.data.id!],
      drive_assignments: { '0': driveId },
      chunk_count: 0,
      is_chunked: false,
    },
  });
}

export async function uploadFile(userId: string, name: string, parentFolderId: string | null, mimeType: string, sizeBytes: number, driveId: string, googleFileId: string) {
  return prisma.file.create({
    data: {
      user_id: userId,
      parent_id: parentFolderId,
      name,
      virtual_path: `/${name}`,
      is_folder: false,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      google_file_ids: [googleFileId],
      drive_assignments: { '0': driveId },
      chunk_count: 1,
      is_chunked: false,
      redundancy_copies: 1,
    },
  });
}

export async function updateFile(userId: string, fileId: string, data: Partial<{ name: string; parent_folder_id: string }>) {
  const file = await prisma.file.findFirst({ where: { id: fileId, user_id: userId } });
  if (!file) throw new Error('File not found');
  return prisma.file.update({ where: { id: fileId }, data });
}

export async function deleteFile(userId: string, fileId: string) {
  const file = await prisma.file.findFirst({
    where: { id: fileId, user_id: userId },
    include: { chunks: true },
  });
  if (!file) throw new Error('File not found');

  for (const chunk of file.chunks) {
    const drive = await prisma.drive.findUnique({ where: { id: chunk.drive_id } });
    if (drive && chunk.google_file_id) {
      try {
        const { client, tokens } = await createAuthenticatedDriveClient(drive.user_id);
        if (tokens?.access_token) {
          const driveApi = google.drive({ version: 'v3', auth: client as any });
          await driveApi.files.delete({ fileId: chunk.google_file_id });
        }
      } catch {
        // Continue deleting other chunks even if one fails
      }
    }
  }

  for (const googleFileId of file.google_file_ids) {
    const drive = file.chunks.length > 0
      ? await prisma.drive.findFirst({ where: { id: file.chunks[0].drive_id } })
      : null;
    if (drive) {
      try {
        const { client, tokens } = await createAuthenticatedDriveClient(drive.user_id);
        if (tokens?.access_token) {
          const driveApi = google.drive({ version: 'v3', auth: client as any });
          await driveApi.files.delete({ fileId: googleFileId });
        }
      } catch {
        // Continue deleting other chunks even if one fails
      }
    }
  }

  await prisma.chunk.deleteMany({ where: { file_id: fileId } });
  await prisma.file.delete({ where: { id: fileId } });
}

export async function searchFiles(userId: string, query: string) {
  return prisma.file.findMany({
    where: {
      user_id: userId,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { virtual_path: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 50,
  });
}
