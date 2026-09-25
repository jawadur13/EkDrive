import { Hono } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { prisma } from '../db/client';
import { parseBody } from '../middleware/validation';
import { FILE_STATUS } from '../services/files';
import { fileResponse } from '../services/file-stream';
import { logActivity } from '../services/activity';
import { HttpError, notFound } from '../utils/errors';

export const shareRoutes = new Hono();

const createShareSchema = z.object({
  fileId: z.string().uuid(),
  expiresAt: z.string().datetime().optional(),
  maxDownloads: z.number().int().positive().optional(),
  permissions: z.enum(['view', 'download']).default('download'),
});

const shareFileSelect = { id: true, name: true, mime_type: true, size_bytes: true } as const;

shareRoutes.post('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const body = await parseBody(c, createShareSchema);

  const file = await prisma.file.findFirst({ where: { id: body.fileId, user_id: userId, trashed_at: null } });
  if (!file) throw notFound('File');
  if (file.is_folder || file.status !== FILE_STATUS.ready) {
    throw new HttpError(400, 'NOT_SHAREABLE', 'Only fully uploaded files can be shared');
  }

  const shareLink = await prisma.shareLink.create({
    data: {
      user_id: userId,
      file_id: file.id,
      token: randomBytes(32).toString('hex'),
      expires_at: body.expiresAt ? new Date(body.expiresAt) : null,
      max_downloads: body.maxDownloads,
      permissions: body.permissions,
    },
    include: { file: { select: shareFileSelect } },
  });
  await logActivity(userId, 'share.created', file, { shareId: shareLink.id, maxDownloads: body.maxDownloads ?? null });
  return c.json(shareLink, 201);
});

shareRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const shares = await prisma.shareLink.findMany({
    where: { user_id: userId },
    include: { file: { select: shareFileSelect } },
    orderBy: { created_at: 'desc' },
  });
  return c.json({ shares });
});

shareRoutes.delete('/:shareId{[0-9a-fA-F-]{36}}', async (c) => {
  const userId = (c as any).get('userId') as string;
  const shareId = c.req.param('shareId');
  const share = await prisma.shareLink.findFirst({ where: { id: shareId, user_id: userId }, include: { file: true } });
  if (!share) throw notFound('Share link');
  await prisma.shareLink.delete({ where: { id: share.id } });
  await logActivity(userId, 'share.revoked', share.file, { shareId });
  return c.json({ id: shareId, message: 'Share link revoked' });
});

// --- Public (no session) — see PUBLIC_PREFIXES in middleware/auth.ts ---

async function getActiveShare(token: string) {
  const share = await prisma.shareLink.findUnique({ where: { token }, include: { file: true } });
  if (!share || share.file.trashed_at) throw notFound('Share link');
  if (share.expires_at && new Date() > share.expires_at) throw new HttpError(410, 'EXPIRED', 'Share link has expired');
  if (share.max_downloads && share.download_count >= share.max_downloads) {
    throw new HttpError(410, 'LIMIT_EXCEEDED', 'Download limit reached');
  }
  return share;
}

shareRoutes.get('/public/:token', async (c) => {
  const share = await getActiveShare(c.req.param('token'));
  return c.json({
    fileName: share.file.name,
    mimeType: share.file.mime_type,
    sizeBytes: share.file.size_bytes,
    permissions: share.permissions,
    expiresAt: share.expires_at,
  });
});

shareRoutes.get('/public/:token/content', async (c) => {
  const share = await getActiveShare(c.req.param('token'));
  const disposition = share.permissions === 'download' && c.req.query('download') === '1' ? 'attachment' : 'inline';

  // Follow-up range requests (a video player seeking) do not count as another download.
  const rangeHeader = c.req.header('Range');
  if (rangeHeader && !/^bytes=0-/.test(rangeHeader)) return fileResponse(c, share.file, disposition);

  // Claim one use atomically so concurrent requests cannot exceed max_downloads.
  const claimed = await prisma.shareLink.updateMany({
    where: {
      id: share.id,
      ...(share.max_downloads ? { download_count: { lt: share.max_downloads } } : {}),
    },
    data: { download_count: { increment: 1 } },
  });
  if (claimed.count === 0) throw new HttpError(410, 'LIMIT_EXCEEDED', 'Download limit reached');

  await logActivity(share.user_id, 'share.accessed', share.file, { shareId: share.id });
  return fileResponse(c, share.file, disposition);
});
