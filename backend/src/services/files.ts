import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { HttpError, notFound, validationError } from '../utils/errors';
import { deleteChunkFromDrive } from './chunk-store';
import { adjustDriveUsage } from './drives';

export const FILE_STATUS = { uploading: 'uploading', ready: 'ready' } as const;

export function validateName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/')) {
    throw validationError('Name must be non-empty and must not contain "/"');
  }
  return trimmed;
}

// Returns the parent folder (or null for root) after checking it belongs to the user.
export async function resolveParentFolder(userId: string, parentId: string | null | undefined) {
  if (!parentId) return null;
  const parent = await prisma.file.findFirst({ where: { id: parentId, user_id: userId, is_folder: true, trashed_at: null } });
  if (!parent) throw notFound('Parent folder');
  return parent;
}

export function buildVirtualPath(parent: { virtual_path: string } | null, name: string) {
  return parent ? `${parent.virtual_path.replace(/\/$/, '')}/${name}` : `/${name}`;
}

export async function listFiles(userId: string, parentFolderId: string | null, cursor: string | null, limit = 50) {
  const take = Math.min(Math.max(limit, 1), 200);
  const where = { user_id: userId, parent_id: parentFolderId, status: FILE_STATUS.ready, trashed_at: null };

  const files = await prisma.file.findMany({
    where,
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ is_folder: 'desc' }, { created_at: 'desc' }, { id: 'asc' }],
  });

  const hasMore = files.length > take;
  if (hasMore) files.pop();

  return {
    files,
    pagination: {
      nextCursor: hasMore ? files[files.length - 1].id : null,
      hasMore,
      totalCount: await prisma.file.count({ where }),
    },
  };
}

// Trashed items are hidden from everything except the trash endpoints.
export async function getFileById(userId: string, fileId: string) {
  return prisma.file.findFirst({ where: { id: fileId, user_id: userId, trashed_at: null } });
}

export async function getBreadcrumbs(userId: string, folderId: string) {
  const trail: Array<{ id: string; name: string }> = [];
  let current = await prisma.file.findFirst({ where: { id: folderId, user_id: userId } });
  while (current && trail.length < 100) {
    trail.unshift({ id: current.id, name: current.name });
    current = current.parent_id ? await prisma.file.findFirst({ where: { id: current.parent_id, user_id: userId } }) : null;
  }
  return trail;
}

// Folders exist only in EkDrive's virtual filesystem; nothing is created on Google Drive.
export async function createFolder(userId: string, rawName: string, parentFolderId: string | null) {
  const name = validateName(rawName);
  const parent = await resolveParentFolder(userId, parentFolderId);
  return prisma.file.create({
    data: {
      user_id: userId,
      parent_id: parent?.id ?? null,
      name,
      virtual_path: buildVirtualPath(parent, name),
      is_folder: true,
      mime_type: 'inode/directory',
      status: FILE_STATUS.ready,
    },
  });
}

async function collectSubtree(userId: string, rootId: string, extraWhere: Prisma.FileWhereInput = {}) {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.file.findMany({
      where: { user_id: userId, parent_id: { in: frontier }, ...extraWhere },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    ids.push(...frontier);
  }
  return ids;
}

export async function updateFile(userId: string, fileId: string, data: { name?: string; parentFolderId?: string | null }) {
  const file = await getFileById(userId, fileId);
  if (!file) throw notFound('File');

  const name = data.name !== undefined ? validateName(data.name) : file.name;
  const parentId = data.parentFolderId !== undefined ? data.parentFolderId : file.parent_id;
  const parent = await resolveParentFolder(userId, parentId);

  if (parent && file.is_folder) {
    const subtree = await collectSubtree(userId, file.id);
    if (subtree.includes(parent.id)) {
      throw new HttpError(409, 'INVALID_MOVE', 'A folder cannot be moved into itself');
    }
  }

  const oldPath = file.virtual_path;
  const newPath = buildVirtualPath(parent, name);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.file.update({
      where: { id: fileId },
      data: { name, parent_id: parent?.id ?? null, virtual_path: newPath, updated_at: new Date() },
    });
    if (file.is_folder && oldPath !== newPath) {
      // Rewrite the path prefix of everything under the folder.
      await tx.$executeRaw`
        UPDATE "File" SET virtual_path = ${newPath} || substring(virtual_path from ${oldPath.length + 1}::int)
        WHERE user_id = ${userId}::uuid AND virtual_path LIKE ${escapeLike(oldPath) + '/%'}`;
    }
    return updated;
  });
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export const TRASH_RETENTION_DAYS = 30;

// Moves a file, or a folder and everything under it, to the trash. Nothing leaves Google
// Drive until the trash is purged, so trashed files still use space.
export async function trashFile(userId: string, fileId: string) {
  const file = await getFileById(userId, fileId);
  if (!file) throw notFound('File');

  const now = new Date();
  // Descendants trashed earlier on their own keep their own trash entry.
  const ids = file.is_folder ? await collectSubtree(userId, fileId, { trashed_at: null }) : [fileId];
  await prisma.$transaction([
    prisma.file.updateMany({ where: { id: { in: ids }, trashed_at: null }, data: { trashed_at: now } }),
    prisma.file.update({ where: { id: fileId }, data: { trash_root: true } }),
  ]);
  return file;
}

export async function listTrash(userId: string) {
  return prisma.file.findMany({
    where: { user_id: userId, trash_root: true, trashed_at: { not: null } },
    orderBy: { trashed_at: 'desc' },
  });
}

async function getTrashRoot(userId: string, fileId: string) {
  const file = await prisma.file.findFirst({ where: { id: fileId, user_id: userId, trash_root: true, trashed_at: { not: null } } });
  if (!file) throw notFound('Trashed item');
  return file;
}

// Restores into the original folder, or to the root if that folder is gone or in the trash.
export async function restoreFile(userId: string, fileId: string) {
  const file = await getTrashRoot(userId, fileId);
  const parent = file.parent_id
    ? await prisma.file.findFirst({ where: { id: file.parent_id, user_id: userId, is_folder: true, trashed_at: null } })
    : null;
  const ids = file.is_folder ? await collectSubtree(userId, fileId, { trashed_at: file.trashed_at }) : [fileId];

  await prisma.$transaction([
    prisma.file.updateMany({ where: { id: { in: ids } }, data: { trashed_at: null } }),
    prisma.file.update({ where: { id: fileId }, data: { trash_root: false } }),
  ]);
  // The parent may have been purged (parent_id is then already null) or be in the trash.
  if (!parent && (file.parent_id || file.virtual_path !== buildVirtualPath(null, file.name))) {
    return updateFile(userId, fileId, { parentFolderId: null });
  }
  return prisma.file.findUniqueOrThrow({ where: { id: fileId } });
}

// The items trashed together with a trash root. A descendant trashed earlier on its own is a
// separate trash entry and is left alone (it becomes a root-level item once its parent goes).
async function trashBatch(userId: string, root: { id: string; is_folder: boolean; trashed_at: Date | null }) {
  return root.is_folder ? collectSubtree(userId, root.id, { trashed_at: root.trashed_at }) : [root.id];
}

// Permanently deletes a trashed item, including its chunks on Google Drive.
export async function purgeTrashItem(userId: string, fileId: string) {
  const file = await getTrashRoot(userId, fileId);
  await removeFiles(await trashBatch(userId, file));
  return file;
}

export async function emptyTrash(userId: string, olderThan?: Date) {
  const roots = await prisma.file.findMany({
    where: { user_id: userId, trash_root: true, trashed_at: olderThan ? { lt: olderThan } : { not: null } },
  });
  for (const root of roots) {
    await removeFiles(await trashBatch(userId, root));
  }
  return roots.length;
}

export async function removeFiles(ids: string[]) {
  const chunks = await prisma.chunk.findMany({ where: { file_id: { in: ids } }, include: { drive: true } });

  for (const chunk of chunks) {
    if (!chunk.google_file_id) continue;
    try {
      await deleteChunkFromDrive(chunk.drive, chunk.google_file_id);
      if (chunk.upload_status === 'uploaded') await adjustDriveUsage(chunk.drive_id, -chunk.size_bytes);
    } catch (error) {
      // Leave the remote object behind rather than blocking the delete; it is only an orphan.
      console.warn(`Could not delete chunk ${chunk.id} from drive ${chunk.drive_id}:`, error);
    }
  }

  await prisma.$transaction([
    prisma.shareLink.deleteMany({ where: { file_id: { in: ids } } }),
    prisma.syncEntry.deleteMany({ where: { file_id: { in: ids } } }),
    prisma.chunk.deleteMany({ where: { file_id: { in: ids } } }),
    prisma.file.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

export async function searchFiles(userId: string, query: string) {
  return prisma.file.findMany({
    where: {
      user_id: userId,
      status: FILE_STATUS.ready,
      trashed_at: null,
      name: { contains: query, mode: 'insensitive' },
    },
    orderBy: [{ is_folder: 'desc' }, { updated_at: 'desc' }],
    take: 50,
  });
}
