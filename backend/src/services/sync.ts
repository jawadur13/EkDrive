import type { Drive } from '@prisma/client';
import type { drive_v3 } from 'googleapis';
import { prisma } from '../db/client';
import { getDriveApi } from '../utils/drive-auth';
import { WRITABLE_DRIVE_STATUSES } from './drives';
import { notify } from './notifications';
import { repairFile } from './replication';

// With the drive.file scope Google only reports changes to files EkDrive created, i.e. chunks.
// Sync watches for chunks deleted or trashed outside EkDrive: the copy is marked 'missing',
// a conflict is recorded, and the file is repaired from a remaining copy when one exists.

export async function getSyncStatus(userId: string) {
  const drives = await prisma.drive.findMany({ where: { user_id: userId }, orderBy: { created_at: 'asc' } });
  const conflicts = await prisma.syncEntry.groupBy({
    by: ['drive_id'],
    where: { user_id: userId, sync_status: 'conflict' },
    _count: true,
  });
  return drives.map((d) => ({
    drive_id: d.id,
    drive_name: d.drive_name,
    status: d.status,
    initialized: Boolean(d.sync_page_token),
    open_conflicts: conflicts.find((c) => c.drive_id === d.id)?._count ?? 0,
  }));
}

export async function syncDrive(drive: Drive) {
  const api = getDriveApi(drive);

  if (!drive.sync_page_token) {
    const start = await api.changes.getStartPageToken({});
    await prisma.drive.update({ where: { id: drive.id }, data: { sync_page_token: start.data.startPageToken } });
    return { drive_id: drive.id, status: 'initialized', changes_count: 0, missing_chunks: 0 };
  }

  let pageToken: string | null | undefined = drive.sync_page_token;
  let newStartPageToken: string | null | undefined = null;
  let changesCount = 0;
  let missingChunks = 0;
  const affectedFiles = new Set<string>();

  while (pageToken) {
    const response: { data: drive_v3.Schema$ChangeList } = await api.changes.list({
      pageToken,
      spaces: 'drive',
      pageSize: 1000,
      fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(trashed))',
    });

    for (const change of response.data.changes ?? []) {
      changesCount++;
      if (!change.fileId || !(change.removed || change.file?.trashed)) continue;

      const chunks = await prisma.chunk.findMany({
        where: { drive_id: drive.id, google_file_id: change.fileId, upload_status: 'uploaded' },
      });
      for (const chunk of chunks) {
        missingChunks++;
        affectedFiles.add(chunk.file_id);
        await prisma.$transaction([
          prisma.chunk.update({ where: { id: chunk.id }, data: { upload_status: 'missing', updated_at: new Date() } }),
          prisma.syncEntry.create({
            data: {
              user_id: drive.user_id,
              drive_id: drive.id,
              file_id: chunk.file_id,
              google_file_id: change.fileId,
              operation: 'delete',
              sync_status: 'conflict',
            },
          }),
        ]);
      }
    }

    newStartPageToken = response.data.newStartPageToken ?? newStartPageToken;
    pageToken = response.data.nextPageToken;
  }

  if (newStartPageToken) {
    await prisma.drive.update({ where: { id: drive.id }, data: { sync_page_token: newStartPageToken } });
  }

  let repaired = 0;
  const damaged: string[] = [];
  for (const fileId of affectedFiles) {
    const result = await repairFile(fileId);
    if (result.lostChunks.length > 0) damaged.push(fileId);
    else if (result.copiesAdded > 0) repaired++;
  }
  if (missingChunks > 0) {
    await notify(drive.user_id, {
      type: damaged.length > 0 ? 'file.damaged' : 'chunks.missing',
      severity: damaged.length > 0 ? 'error' : 'warning',
      title: `${missingChunks} chunk(s) were deleted from ${drive.google_email ?? drive.drive_name} outside EkDrive`,
      body:
        damaged.length > 0
          ? `${damaged.length} file(s) have no remaining copy of some data and cannot be fully downloaded. ${repaired} file(s) were repaired.`
          : `${repaired} file(s) were repaired from their other copies.`,
    });
  }

  return {
    drive_id: drive.id,
    status: 'synced',
    changes_count: changesCount,
    missing_chunks: missingChunks,
    files_repaired: repaired,
    files_damaged: damaged.length,
  };
}

export async function triggerSync(userId: string) {
  const drives = await prisma.drive.findMany({ where: { user_id: userId, status: { in: WRITABLE_DRIVE_STATUSES } } });
  const results = [];
  for (const drive of drives) {
    try {
      results.push(await syncDrive(drive));
    } catch (error: any) {
      results.push({ drive_id: drive.id, status: 'failed', reason: error?.message ?? 'Unknown error' });
    }
  }
  return { triggered: drives.length, results };
}

export async function getConflicts(userId: string) {
  return prisma.syncEntry.findMany({
    where: { user_id: userId, sync_status: 'conflict' },
    include: { file: { select: { id: true, name: true, virtual_path: true } } },
    orderBy: { created_at: 'desc' },
  });
}

// 'local' keeps EkDrive's copy: the file is repaired from its remaining copies.
// 'remote' accepts the deletion and closes the entry.
export async function resolveConflict(userId: string, conflictId: string, resolution: 'local' | 'remote') {
  const entry = await prisma.syncEntry.findFirst({ where: { id: conflictId, user_id: userId, sync_status: 'conflict' } });
  if (!entry) return null;
  if (resolution === 'local' && entry.file_id) await repairFile(entry.file_id);
  return prisma.syncEntry.update({
    where: { id: entry.id },
    data: { sync_status: 'resolved', conflict_resolution: resolution, resolved_at: new Date() },
  });
}
