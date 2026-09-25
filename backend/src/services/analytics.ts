import { prisma } from '../db/client';
import { FILE_STATUS } from './files';

// Coarse type buckets for the breakdown; matched against mime_type.
const TYPE_BUCKET_SQL = `
  CASE
    WHEN mime_type LIKE 'image/%' THEN 'Images'
    WHEN mime_type LIKE 'video/%' THEN 'Video'
    WHEN mime_type LIKE 'audio/%' THEN 'Audio'
    WHEN mime_type = 'application/pdf' OR mime_type LIKE 'text/%'
      OR mime_type LIKE 'application/vnd.openxmlformats%' OR mime_type LIKE 'application/msword%'
      OR mime_type LIKE 'application/vnd.ms-%' THEN 'Documents'
    WHEN mime_type IN ('application/zip', 'application/x-7z-compressed', 'application/x-rar-compressed',
      'application/gzip', 'application/x-tar') THEN 'Archives'
    ELSE 'Other'
  END`;

export async function getAnalytics(userId: string, days = 30) {
  const live = { user_id: userId, is_folder: false, status: FILE_STATUS.ready, trashed_at: null };

  const [files, folders, trash, drives, chunkBytes, byType, uploads] = await Promise.all([
    prisma.file.aggregate({ where: live, _count: true, _sum: { size_bytes: true } }),
    prisma.file.count({ where: { user_id: userId, is_folder: true, trashed_at: null } }),
    prisma.file.aggregate({
      where: { user_id: userId, is_folder: false, trashed_at: { not: null } },
      _count: true,
      _sum: { size_bytes: true },
    }),
    prisma.drive.findMany({ where: { user_id: userId }, orderBy: { created_at: 'asc' } }),
    prisma.chunk.groupBy({
      by: ['drive_id'],
      where: { upload_status: 'uploaded', drive: { user_id: userId } },
      _sum: { size_bytes: true },
      _count: true,
    }),
    prisma.$queryRawUnsafe<Array<{ bucket: string; files: bigint; bytes: bigint | null }>>(
      `SELECT ${TYPE_BUCKET_SQL} AS bucket, COUNT(*) AS files, SUM(size_bytes) AS bytes
       FROM "File"
       WHERE user_id = $1::uuid AND is_folder = false AND status = 'ready' AND trashed_at IS NULL
       GROUP BY bucket ORDER BY bytes DESC NULLS LAST`,
      userId
    ),
    prisma.$queryRaw<Array<{ day: Date; files: bigint; bytes: bigint | null }>>`
      SELECT date_trunc('day', created_at) AS day, COUNT(*) AS files, SUM(size_bytes) AS bytes
      FROM "File"
      WHERE user_id = ${userId}::uuid AND is_folder = false AND status = 'ready'
        AND created_at >= now() - make_interval(days => ${days}::int)
      GROUP BY day ORDER BY day`,
  ]);

  const storedBytes = chunkBytes.reduce((sum, row) => sum + (row._sum.size_bytes ?? 0n), 0n);

  // Every day in the window, including days with no uploads.
  const byDay = new Map(uploads.map((u) => [u.day.toISOString().slice(0, 10), u]));
  const timeline = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(date);
    return { date, files: Number(row?.files ?? 0), bytes: Number(row?.bytes ?? 0) };
  });

  return {
    totals: {
      files: files._count,
      folders,
      logicalBytes: files._sum.size_bytes ?? 0n,
      // Physical bytes across all copies, i.e. what the files cost in Google storage.
      storedBytes,
      trashFiles: trash._count,
      trashBytes: trash._sum.size_bytes ?? 0n,
      poolTotalBytes: drives.every((d) => d.total_quota_bytes !== null)
        ? drives.reduce((sum, d) => sum + (d.total_quota_bytes ?? 0n), 0n)
        : null,
      poolAvailableBytes: drives.reduce((sum, d) => sum + (d.available_quota_bytes ?? 0n), 0n),
    },
    drives: drives.map((d) => {
      const own = chunkBytes.find((row) => row.drive_id === d.id);
      return {
        id: d.id,
        name: d.google_email ?? d.drive_name,
        status: d.status,
        totalBytes: d.total_quota_bytes,
        usedBytes: d.used_quota_bytes ?? 0n,
        ekdriveBytes: own?._sum.size_bytes ?? 0n,
        chunks: own?._count ?? 0,
      };
    }),
    byType: byType.map((row) => ({ type: row.bucket, files: Number(row.files), bytes: Number(row.bytes ?? 0) })),
    timeline,
  };
}
