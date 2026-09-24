import { google, type Auth } from 'googleapis';
import { prisma } from '../db/client';
import { encrypt } from '../utils/crypto';
import { createOAuthClient, getDriveOAuthClient } from '../utils/drive-auth';

// Drive.status values. Health checks write these; placement only uses 'online' and 'degraded'.
export const DRIVE_STATUS = {
  online: 'online',
  degraded: 'degraded',
  offline: 'offline',
} as const;

export const WRITABLE_DRIVE_STATUSES = [DRIVE_STATUS.online, DRIVE_STATUS.degraded];

// Fields safe to send to the browser — never the encrypted tokens.
const publicDriveSelect = {
  id: true,
  drive_name: true,
  google_email: true,
  drive_type: true,
  total_quota_bytes: true,
  used_quota_bytes: true,
  available_quota_bytes: true,
  status: true,
  last_health_check: true,
  created_at: true,
} as const;

export class DriveOwnershipError extends Error {}

export async function getDrivesByUser(userId: string) {
  return prisma.drive.findMany({ where: { user_id: userId }, select: publicDriveSelect, orderBy: { created_at: 'asc' } });
}

export async function getDriveById(userId: string, driveId: string) {
  return prisma.drive.findFirst({ where: { id: driveId, user_id: userId }, select: publicDriveSelect });
}

// Creates or refreshes the Drive record for the Google account that just completed OAuth.
// A Google account can belong to only one EkDrive user.
export async function upsertConnectedDrive(userId: string, tokens: Auth.Credentials, email: string) {
  if (!tokens.access_token) throw new Error('No access token');

  const client = createOAuthClient();
  client.setCredentials(tokens);
  const driveApi = google.drive({ version: 'v3', auth: client });

  const about = await driveApi.about.get({ fields: 'user(permissionId,emailAddress),storageQuota(limit,usage)' });
  const permissionId = about.data.user?.permissionId;
  if (!permissionId) throw new Error('Could not identify Google Drive account');

  const existing = await prisma.drive.findUnique({ where: { google_drive_id: permissionId } });
  if (existing && existing.user_id !== userId) {
    throw new DriveOwnershipError('This Google account is already connected to another EkDrive user');
  }

  const quota = quotaFromAbout(about.data.storageQuota);

  let rootFolderId = existing?.root_folder_id;
  if (!rootFolderId) {
    const folder = await driveApi.files.create({
      requestBody: { name: 'EkDrive', mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    rootFolderId = folder.data.id!;
  }

  // Start watching for changes from the moment the drive is connected.
  const syncPageToken = existing?.sync_page_token ?? (await driveApi.changes.getStartPageToken({})).data.startPageToken;

  const tokenData = {
    oauth_token_encrypted: encrypt(tokens.access_token),
    // Google only returns a refresh token on consent; keep the stored one otherwise.
    refresh_token_encrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : existing?.refresh_token_encrypted ?? null,
    token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };

  return prisma.drive.upsert({
    where: { google_drive_id: permissionId },
    create: {
      user_id: userId,
      drive_name: email,
      google_email: email,
      google_drive_id: permissionId,
      root_folder_id: rootFolderId,
      status: DRIVE_STATUS.online,
      sync_page_token: syncPageToken,
      ...quota,
      ...tokenData,
    },
    update: {
      google_email: email,
      status: DRIVE_STATUS.online,
      ...quota,
      ...tokenData,
    },
    select: publicDriveSelect,
  });
}

export function quotaFromAbout(storageQuota: { limit?: string | null; usage?: string | null } | null | undefined) {
  const used = BigInt(storageQuota?.usage ?? '0');
  // No limit means an unlimited (e.g. Workspace pooled) account.
  const total = storageQuota?.limit ? BigInt(storageQuota.limit) : null;
  const available = total !== null ? (total > used ? total - used : 0n) : BigInt(Number.MAX_SAFE_INTEGER);
  return { total_quota_bytes: total, used_quota_bytes: used, available_quota_bytes: available };
}

export class DriveInUseError extends Error {}

export async function deleteDrive(userId: string, driveId: string) {
  const drive = await prisma.drive.findFirst({ where: { id: driveId, user_id: userId } });
  if (!drive) return null;

  const chunkCount = await prisma.chunk.count({ where: { drive_id: driveId } });
  if (chunkCount > 0) {
    throw new DriveInUseError(`Drive still holds ${chunkCount} chunk(s); delete or move those files first`);
  }

  try {
    await getDriveOAuthClient(drive).revokeCredentials();
  } catch {
    // Token already revoked or invalid; the local record is removed regardless.
  }

  await prisma.$transaction([
    prisma.healthCheck.deleteMany({ where: { drive_id: driveId } }),
    prisma.syncEntry.deleteMany({ where: { drive_id: driveId } }),
    prisma.drive.delete({ where: { id: driveId } }),
  ]);
  return drive;
}

// Keeps the cached quota roughly right between health checks after chunks are written or removed.
export async function adjustDriveUsage(driveId: string, deltaBytes: bigint) {
  const drive = await prisma.drive.findUnique({ where: { id: driveId } });
  if (!drive) return;
  const used = (drive.used_quota_bytes ?? 0n) + deltaBytes;
  const available = (drive.available_quota_bytes ?? 0n) - deltaBytes;
  await prisma.drive.update({
    where: { id: driveId },
    data: { used_quota_bytes: used < 0n ? 0n : used, available_quota_bytes: available < 0n ? 0n : available },
  });
}
