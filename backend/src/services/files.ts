import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';

const prisma = new PrismaClient();

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

  const tokens = await getDecryptedTokens(drive.user_id);
  if (!tokens?.access_token) throw new Error('No access token');

  const oauth2Client = getOAuthClient(drive.user_id);
  const driveApi = google.drive({ version: 'v3', auth: oauth2Client });

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
  return prisma.file.update({ where: { id: fileId, user_id: userId }, data });
}

export async function deleteFile(userId: string, fileId: string) {
  const file = await prisma.file.findFirst({ where: { id: fileId, user_id: userId } });
  if (!file) throw new Error('File not found');

  for (const googleFileId of file.google_file_ids) {
    const driveId = file.drive_assignments?.[googleFileId];
    if (driveId) {
      const drive = await prisma.drive.findUnique({ where: { id: driveId } });
      if (drive) {
        try {
          const tokens = await getDecryptedTokens(drive.user_id);
          if (tokens?.access_token) {
            const oauth2Client = getOAuthClient(drive.user_id);
            const driveApi = google.drive({ version: 'v3', auth: oauth2Client });
            await driveApi.files.delete({ fileId: googleFileId });
          }
        } catch {
          // Continue deleting other chunks even if one fails
        }
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

async function getDecryptedTokens(userId: string) {
  const authToken = await prisma.authToken.findUnique({ where: { user_id: userId } });
  if (!authToken) return null;

  const { createDecipheriv, scryptSync } = await import('crypto');
  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
  const IV_LENGTH = 16;

  const decrypt = (encryptedText: string): string => {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const key = scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  };

  return {
    access_token: decrypt(authToken.access_token),
    refresh_token: authToken.refresh_token ? decrypt(authToken.refresh_token) : null,
    token_expiry: authToken.token_expiry,
  };
}

function getOAuthClient(userId: string) {
  const { OAuth2Client } = require('google-auth-library');
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/auth/callback`
  );
}