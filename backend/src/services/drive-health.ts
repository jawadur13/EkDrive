import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import { getDecryptedTokens, getOAuthClient, refreshAccessToken } from '../utils/drive-auth';

const prisma = new PrismaClient();

export async function checkDriveHealth(driveId: string) {
  const drive = await prisma.drive.findUnique({ where: { id: driveId } });
  if (!drive) return null;

  const startTime = Date.now();
  let status = 'healthy';
  let latencyMs = 0;
  let quotaAvailable: bigint | null = null;
  let errorMessage: string | null = null;

  try {
    const tokens = await getDecryptedTokens(drive.user_id);
    if (!tokens?.access_token) {
      status = 'offline';
      errorMessage = 'No access token available';
    } else {
      const oauth2Client = getOAuthClient(drive.user_id);
      const driveApi = google.drive({ version: 'v3', auth: oauth2Client });

      const about = await driveApi.about.get({ fields: 'storageQuota' });
      latencyMs = Date.now() - startTime;

      const quota = about.data.storageQuota;
      quotaAvailable = quota?.available ? BigInt(quota.available) : null;

      if (quotaAvailable !== null && drive.total_quota_bytes) {
        const utilization = Number(quotaAvailable) / Number(drive.total_quota_bytes);
        if (utilization < 0.01) {
          status = 'degraded';
        }
      }
    }
  } catch (error: any) {
    latencyMs = Date.now() - startTime;
    status = 'offline';
    errorMessage = error?.message || 'Unknown error';

    if (error?.response?.status === 401 || error?.response?.status === 403) {
      const newToken = await refreshAccessToken(drive.user_id);
      if (newToken) {
        status = 'healthy';
        errorMessage = null;
      }
    }
  }

  await prisma.healthCheck.create({
    data: {
      drive_id: driveId,
      user_id: drive.user_id,
      status,
      latency_ms: latencyMs,
      quota_available: quotaAvailable,
      error_message: errorMessage,
    },
  });

  await prisma.drive.update({
    where: { id: driveId },
    data: {
      status: status as any,
      last_health_check: new Date(),
      available_quota_bytes: quotaAvailable ?? drive.available_quota_bytes,
    },
  });

  return { driveId, status, latencyMs, quotaAvailable, errorMessage };
}

export async function getAllDriveHealth(userId: string) {
  const drives = await prisma.drive.findMany({ where: { user_id: userId } });
  const results = [];

  for (const drive of drives) {
    const health = await checkDriveHealth(drive.id);
    results.push({
      drive_id: drive.id,
      drive_name: drive.drive_name,
      status: health?.status ?? drive.status,
      quota_used: drive.used_quota_bytes,
      quota_total: drive.total_quota_bytes,
      quota_available: health?.quotaAvailable ?? drive.available_quota_bytes,
      utilization_percent: drive.total_quota_bytes
        ? Number(drive.used_quota_bytes) / Number(drive.total_quota_bytes) * 100
        : 0,
      last_health_check: drive.last_health_check,
    });
  }

  return results;
}