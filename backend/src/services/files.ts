import { prisma } from '../db/client';
import { z } from 'zod';

const createFileSchema = z.object({
  name: z.string().min(1).max(1024),
  parentFolderId: z.string().uuid().optional(),
  isFolder: z.boolean().default(false),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  checksum: z.string().optional(),
});

export async function listFiles(userId: string, parentFolderId: string | null, cursor: string | null, limit: number = 50) {
  const where: { user_id: string; parent_id?: string | null } = { user_id: userId };
  if (parentFolderId !== null) {
    where.parent_id = parentFolderId;
  } else {
    where.parent_id = null;
  }

  const files = await prisma.file.findMany({
    where,
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { created_at: 'desc' },
  });

  const hasMore = files.length > limit;
  if (hasMore) files.pop();

  return {
    files,
    pagination: {
      nextCursor: hasMore ? files[files.length - 1]?.id ?? null : null,
      hasMore,
      totalCount: await prisma.file.count({ where }),
    },
  };
}

export async function getFileById(userId: string, fileId: string) {
  return prisma.file.findFirst({ where: { id: fileId, user_id: userId } });
}

export async function createFile(userId: string, data: { name: string; parent_folder_id?: string; is_folder: boolean; mime_type?: string; size_bytes?: number; checksum?: string }) {
  return prisma.file.create({
    data: {
      ...data,
      user_id: userId,
      virtual_path: `/${data.name}`,
    },
  });
}

export async function updateFile(userId: string, fileId: string, data: Partial<{ name: string; parent_folder_id: string }>) {
  return prisma.file.update({ where: { id: fileId, user_id: userId }, data });
}

export async function deleteFile(userId: string, fileId: string) {
  return prisma.file.delete({ where: { id: fileId, user_id: userId } });
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