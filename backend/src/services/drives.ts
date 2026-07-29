import { prisma } from '../db/client';

export async function getDrivesByUser(userId: string) {
  return prisma.drive.findMany({ where: { user_id: userId } });
}

export async function getDriveById(userId: string, driveId: string) {
  return prisma.drive.findFirst({ where: { id: driveId, user_id: userId } });
}

export async function createDrive(userId: string, data: { drive_name: string; google_drive_id: string; root_folder_id: string; oauth_token_encrypted?: string; total_quota_bytes?: number; used_quota_bytes?: number }) {
  return prisma.drive.create({
    data: {
      user_id: userId,
      drive_name: data.drive_name,
      google_drive_id: data.google_drive_id,
      root_folder_id: data.root_folder_id,
      oauth_token_encrypted: data.oauth_token_encrypted || '',
      total_quota_bytes: data.total_quota_bytes || 0,
      used_quota_bytes: data.used_quota_bytes || 0,
      available_quota_bytes: (data.total_quota_bytes ?? 0) - (data.used_quota_bytes ?? 0),
    },
  });
}

export async function deleteDrive(userId: string, driveId: string) {
  const drive = await prisma.drive.findFirst({ where: { id: driveId, user_id: userId } });
  if (!drive) throw new Error('Drive not found');
  return prisma.drive.delete({ where: { id: driveId } });
}

export async function updateDriveQuota(driveId: string, usedQuota: number, totalQuota: number) {
  return prisma.drive.update({
    where: { id: driveId },
    data: { used_quota_bytes: usedQuota, total_quota_bytes: totalQuota, available_quota_bytes: totalQuota - usedQuota },
  });
}
