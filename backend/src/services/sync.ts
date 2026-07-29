import { prisma } from '../db/client';

export async function getSyncStatus(userId: string) {
  const drives = await prisma.drive.findMany({ where: { user_id: userId } });
  return drives.map((d) => ({
    drive_id: d.id,
    drive_name: d.drive_name,
    status: d.status,
    last_sync_time: d.last_sync_time,
    sync_token: d.sync_token,
    pending_changes: 0,
  }));
}

export async function triggerSync(userId: string) {
  const drives = await prisma.drive.findMany({ where: { user_id: userId, status: 'online' } });
  return { triggered: drives.length, drives: drives.map((d) => d.id) };
}

export async function getConflicts(userId: string) {
  return prisma.syncEntry.findMany({
    where: { user_id: userId, sync_status: 'conflict' },
    include: { file: true },
  });
}

export async function resolveConflict(userId: string, conflictId: string, resolution: string) {
  return prisma.syncEntry.update({
    where: { id: conflictId },
    data: { sync_status: 'synced', conflict_resolution: resolution as any, resolved_at: new Date() },
  });
}