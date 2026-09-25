import { prisma } from '../db/client';

export type NotificationInput = {
  type: 'drive.offline' | 'drive.degraded' | 'drive.recovered' | 'chunks.missing' | 'file.damaged' | 'repair.done' | 'rebalance.done' | 'trash.purged';
  severity?: 'info' | 'warning' | 'error';
  title: string;
  body?: string;
};

const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

// Best effort, and an identical unread notification from the last hour is not repeated —
// background jobs re-detect the same condition on every run.
export async function notify(userId: string, input: NotificationInput) {
  try {
    const duplicate = await prisma.notification.findFirst({
      where: {
        user_id: userId,
        type: input.type,
        title: input.title,
        read_at: null,
        created_at: { gt: new Date(Date.now() - DEDUPE_WINDOW_MS) },
      },
    });
    if (duplicate) return duplicate;
    return await prisma.notification.create({
      data: { user_id: userId, type: input.type, severity: input.severity ?? 'info', title: input.title, body: input.body },
    });
  } catch (error) {
    console.warn(`Failed to create notification for ${userId}:`, error);
    return null;
  }
}

export async function listNotifications(userId: string, limit = 30) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    }),
    prisma.notification.count({ where: { user_id: userId, read_at: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  const { count } = await prisma.notification.updateMany({
    where: { user_id: userId, read_at: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { read_at: new Date() },
  });
  return count;
}
