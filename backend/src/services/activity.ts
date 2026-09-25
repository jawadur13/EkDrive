import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client';

export type ActivityAction =
  | 'file.uploaded'
  | 'folder.created'
  | 'file.renamed'
  | 'file.moved'
  | 'file.trashed'
  | 'file.restored'
  | 'file.deleted'
  | 'file.repaired'
  | 'share.created'
  | 'share.revoked'
  | 'share.accessed'
  | 'drive.connected'
  | 'drive.disconnected'
  | 'storage_mode.changed'
  | 'storage.rebalanced';

// Best effort: a failed log write must never fail the action being logged.
export async function logActivity(
  userId: string,
  action: ActivityAction,
  file?: { id: string; name: string } | null,
  details?: Prisma.InputJsonValue
) {
  try {
    await prisma.activity.create({
      data: { user_id: userId, action, file_id: file?.id, file_name: file?.name, details },
    });
  } catch (error) {
    console.warn(`Failed to log activity ${action} for ${userId}:`, error);
  }
}

export async function listActivity(userId: string, cursor: string | null, limit = 50) {
  const take = Math.min(Math.max(limit, 1), 100);
  const items = await prisma.activity.findMany({
    where: { user_id: userId },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  if (hasMore) items.pop();
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
