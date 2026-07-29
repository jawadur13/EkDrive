import { prisma } from '../db/client';

export async function checkDriveHealth(driveId: string) {
  const drive = await prisma.drive.findUnique({ where: { id: driveId } });
  if (!drive) return null;

  const healthCheck = {
    drive_id: driveId,
    status: drive.status === 'online' ? 'healthy' : 'offline',
    latency_ms: 0,
    quota_available: drive.available_quota_bytes,
    checked_at: new Date(),
  };

  await prisma.healthCheck.create({ data: healthCheck });

  return healthCheck;
}

export async function getAllDriveHealth(userId: string) {
  const drives = await prisma.drive.findMany({ where: { user_id: userId } });
  const results = [];

  for (const drive of drives) {
    results.push({
      drive_id: drive.id,
      drive_name: drive.drive_name,
      status: drive.status,
      quota_used: drive.used_quota_bytes,
      quota_total: drive.total_quota_bytes,
      quota_available: drive.available_quota_bytes,
      utilization_percent: drive.total_quota_bytes
        ? Number(drive.used_quota_bytes) / Number(drive.total_quota_bytes) * 100
        : 0,
      last_health_check: drive.last_health_check,
    });
  }

  return results;
}

export async function updateDriveStatus(driveId: string, status: string) {
  return prisma.drive.update({
    where: { id: driveId },
    data: { status: status as any, last_health_check: new Date() },
  });
}