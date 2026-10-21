import sharp from 'sharp';
import type { File } from '@prisma/client';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { streamFileContent } from './file-stream';
import { FILE_STATUS } from './files';

export const THUMBNAIL_SIZE = 256;

/** Reading a 100 MB photo back from Google to make a 256px square is not worth it. */
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

const THUMBNAILABLE = /^image\/(png|jpe?g|gif|webp|avif|bmp|tiff)$/;

export function isThumbnailable(file: Pick<File, 'mime_type' | 'size_bytes' | 'is_folder' | 'status'>) {
  return (
    !file.is_folder &&
    file.status === FILE_STATUS.ready &&
    THUMBNAILABLE.test(file.mime_type ?? '') &&
    Number(file.size_bytes ?? 0) <= MAX_SOURCE_BYTES
  );
}

async function readWholeFile(file: File) {
  const stream = await streamFileContent(file);
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/**
 * Made on first request rather than at upload: most files are never looked at in a list, and
 * generating one means pulling every chunk back from Google. Once made it is kept, so the
 * grid costs one small database read per file after that.
 */
export async function getOrCreateThumbnail(file: File) {
  const existing = await prisma.thumbnail.findUnique({ where: { file_id: file.id } });
  if (existing) return existing;
  if (!isThumbnailable(file)) return null;

  const source = await readWholeFile(file);
  const image = sharp(source, { failOn: 'none' })
    .rotate() // honours the EXIF orientation, so portrait photos are not shown sideways
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover', position: 'attention' })
    .webp({ quality: 72 });

  const { data, info } = await image.toBuffer({ resolveWithObject: true });

  try {
    return await prisma.thumbnail.create({
      data: { file_id: file.id, bytes: data, width: info.width, height: info.height },
    });
  } catch (error) {
    // Two requests can race for the same new thumbnail; whoever lost just reads the winner's.
    const stored = await prisma.thumbnail.findUnique({ where: { file_id: file.id } });
    if (stored) return stored;
    logger.warn({ err: error, fileId: file.id }, 'Could not store a thumbnail');
    return { file_id: file.id, bytes: data, width: info.width, height: info.height, created_at: new Date() };
  }
}
