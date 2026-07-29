import { prisma } from '../db/client';
import { google } from 'googleapis';
import { createAuthenticatedDriveClient } from '../utils/drive-auth';

export async function getSyncStatus(userId: string) {
  const drives = await prisma.drive.findMany({ where: { user_id: userId } });
  return drives.map((d) => ({
    drive_id: d.id,
    drive_name: d.drive_name,
    status: d.status,
    last_sync_time: d.last_health_check,
    pending_changes: 0,
  }));
}

export async function triggerSync(userId: string) {
  const drives = await prisma.drive.findMany({ where: { user_id: userId, status: 'online' } });
  const results = [];

  for (const drive of drives) {
    try {
      const { client, tokens } = await createAuthenticatedDriveClient(drive.user_id);
      if (!tokens?.access_token) {
        results.push({ drive_id: drive.id, status: 'skipped', reason: 'no_token' });
        continue;
      }

      const driveApi = google.drive({ version: 'v3', auth: client as any });

      const params: Record<string, string> = {
        spaces: 'drive',
        fields: 'changes(kind,fileId,name,mimeType,modifiedTime,trashed,parents),nextPageToken,newStartPageToken',
      };

      const response = await driveApi.changes.list(params);
      const changes = (response.data as any).changes || [];
      const newSyncToken = (response.data as any).newStartPageToken;

      for (const change of changes) {
        if (change.fileId) {
          await prisma.syncEntry.create({
            data: {
              user_id: userId,
              drive_id: drive.id,
              google_file_id: change.fileId,
              operation: change.kind === 'change' ? 'update' : 'create',
              sync_status: 'pending',
            },
          });
        }
      }

      results.push({ drive_id: drive.id, status: 'synced', changes_count: changes.length, sync_token: newSyncToken });
    } catch (error: any) {
      results.push({ drive_id: drive.id, status: 'failed', reason: error?.message });
    }
  }

  return { triggered: drives.length, results };
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
