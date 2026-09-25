import { Hono } from 'hono';
import { prisma } from '../db/client';
import { FILE_STATUS } from '../services/files';
import { fileResponse } from '../services/file-stream';
import { HttpError, notFound } from '../utils/errors';

export const downloadRoutes = new Hono();

// Types the browser may render inline; everything else is always downloaded.
const PREVIEWABLE = [/^image\/(png|jpe?g|gif|webp|avif|bmp)$/, /^application\/pdf$/, /^video\//, /^audio\//, /^text\/plain$/];

async function getReadyFile(userId: string, fileId: string) {
  const file = await prisma.file.findFirst({ where: { id: fileId, user_id: userId, trashed_at: null } });
  if (!file) throw notFound('File');
  if (file.is_folder) throw new HttpError(400, 'IS_FOLDER', 'Folders cannot be downloaded');
  if (file.status !== FILE_STATUS.ready) throw new HttpError(409, 'FILE_INCOMPLETE', 'File upload has not finished');
  return file;
}

downloadRoutes.get('/:fileId{[0-9a-fA-F-]{36}}/download', async (c) => {
  const file = await getReadyFile((c as any).get('userId'), c.req.param('fileId'));
  return fileResponse(c, file, 'attachment');
});

downloadRoutes.get('/:fileId{[0-9a-fA-F-]{36}}/preview', async (c) => {
  const file = await getReadyFile((c as any).get('userId'), c.req.param('fileId'));
  const inline = PREVIEWABLE.some((re) => re.test(file.mime_type ?? ''));
  return fileResponse(c, file, inline ? 'inline' : 'attachment');
});
