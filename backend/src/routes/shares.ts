import { Hono } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { prisma } from '../db/client';

export const shareRoutes = new Hono();

const createShareSchema = z.object({
  file_id: z.string().uuid(),
  expires_at: z.string().datetime().optional(),
  max_downloads: z.number().int().nonnegative().optional(),
  permissions: z.enum(['view', 'download']).default('view'),
});

shareRoutes.post('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const body = await c.req.json();
  const parsed = createShareSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 422);
  }

  const file = await prisma.file.findFirst({ where: { id: parsed.data.file_id, user_id: userId } });
  if (!file) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404);
  }

  const token = randomBytes(32).toString('hex');

  const shareLink = await prisma.shareLink.create({
    data: {
      user_id: userId,
      file_id: parsed.data.file_id,
      token,
      expires_at: parsed.data.expires_at ? new Date(parsed.data.expires_at) : null,
      max_downloads: parsed.data.max_downloads,
      permissions: parsed.data.permissions,
    },
  });

  return c.json(shareLink, 201);
});

shareRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const shares = await prisma.shareLink.findMany({ where: { user_id: userId }, include: { file: true } });
  return c.json({ shares });
});

shareRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');

  const shareLink = await prisma.shareLink.findUnique({
    where: { token },
    include: { file: true },
  });

  if (!shareLink) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Share link not found' } }, 404);
  }

  if (shareLink.expires_at && new Date() > shareLink.expires_at) {
    return c.json({ error: { code: 'EXPIRED', message: 'Share link has expired' } }, 410);
  }

  if (shareLink.max_downloads && shareLink.download_count >= shareLink.max_downloads) {
    return c.json({ error: { code: 'LIMIT_EXCEEDED', message: 'Download limit reached' } }, 410);
  }

  await prisma.shareLink.update({
    where: { id: shareLink.id },
    data: { download_count: { increment: 1 } },
  });

  return c.json({
    file_id: shareLink.file_id,
    file_name: shareLink.file.name,
    mime_type: shareLink.file.mime_type,
    size_bytes: shareLink.file.size_bytes,
    permissions: shareLink.permissions,
  });
});

shareRoutes.delete('/:shareId', async (c) => {
  const userId = (c as any).get('userId') as string;
  const shareId = c.req.param('shareId');

  const shareLink = await prisma.shareLink.findFirst({ where: { id: shareId, user_id: userId } });
  if (!shareLink) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Share link not found' } }, 404);
  }

  await prisma.shareLink.delete({ where: { id: shareId } });
  return c.json({ id: shareId, message: 'Share link revoked' });
});
