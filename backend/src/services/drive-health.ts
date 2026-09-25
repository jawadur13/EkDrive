import { prisma } from '../db/client';
import { getDriveApi } from '../utils/drive-auth';
import { DRIVE_STATUS, quotaFromAbout } from './drives';
import { notify } from './notifications';

// Below this much free space a drive is marked degraded (still writable, but flagged).
const LOW_SPACE_RATIO = 0.01;

export async function checkDriveHealth(driveId: string) {
  const drive = await prisma.drive.findUnique({ where: { id: driveId } });
  if (!drive) return null;

  const startTime = Date.now();
  let status: string = DRIVE_STATUS.online;
  let errorMessage: string | null = null;
  let quota: ReturnType<typeof quotaFromAbout> | null = null;

  try {
    // The client refreshes an expired access token on its own and persists the new one.
    const about = await getDriveApi(drive).about.get({ fields: 'storageQuota(limit,usage)' });
    quota = quotaFromAbout(about.data.storageQuota);
    if (quota.total_quota_bytes && Number(quota.available_quota_bytes) / Number(quota.total_quota_bytes) < LOW_SPACE_RATIO) {
      status = DRIVE_STATUS.degraded;
    }
  } catch (error: any) {
    status = DRIVE_STATUS.offline;
    errorMessage = error?.message || 'Unknown error';
  }
  const latencyMs = Date.now() - startTime;

  await prisma.$transaction([
    prisma.healthCheck.create({
      data: {
        drive_id: driveId,
        user_id: drive.user_id,
        status,
        latency_ms: latencyMs,
        quota_available: quota?.available_quota_bytes ?? null,
        error_message: errorMessage,
      },
    }),
    prisma.drive.update({
      where: { id: driveId },
      data: { status, last_health_check: new Date(), ...(quota ?? {}) },
    }),
  ]);

  if (status !== drive.status) {
    const name = drive.google_email ?? drive.drive_name;
    if (status === DRIVE_STATUS.offline) {
      await notify(drive.user_id, {
        type: 'drive.offline',
        severity: 'error',
        title: `${name} is unreachable`,
        body: `New uploads skip this drive. If it stays offline, reconnect it in Settings. (${errorMessage})`,
      });
    } else if (status === DRIVE_STATUS.degraded) {
      await notify(drive.user_id, { type: 'drive.degraded', severity: 'warning', title: `${name} is almost full` });
    } else if (drive.status === DRIVE_STATUS.offline) {
      await notify(drive.user_id, { type: 'drive.recovered', title: `${name} is back online` });
    }
  }

  return { driveId, status, latencyMs, quotaAvailable: quota?.available_quota_bytes ?? null, errorMessage };
}

// Reads the last recorded state; checks run in the background worker (or on demand per drive).
export async function getAllDriveHealth(userId: string) {
  const drives = await prisma.drive.findMany({ where: { user_id: userId }, orderBy: { created_at: 'asc' } });
  return drives.map((drive) => ({
    drive_id: drive.id,
    drive_name: drive.drive_name,
    status: drive.status,
    quota_used: drive.used_quota_bytes,
    quota_total: drive.total_quota_bytes,
    quota_available: drive.available_quota_bytes,
    utilization_percent: drive.total_quota_bytes
      ? (Number(drive.used_quota_bytes ?? 0n) / Number(drive.total_quota_bytes)) * 100
      : 0,
    last_health_check: drive.last_health_check,
  }));
}
