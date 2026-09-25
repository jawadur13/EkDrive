import '../env';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../db/client';
import { checkDriveHealth } from '../services/drive-health';
import { syncDrive } from '../services/sync';
import { emptyTrash, FILE_STATUS, removeFiles, TRASH_RETENTION_DAYS } from '../services/files';
import { notify } from '../services/notifications';
import { WRITABLE_DRIVE_STATUSES } from '../services/drives';

const DAY_MS = 24 * 60 * 60 * 1000;

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

// Each job runs on its own schedule in a single 'maintenance' queue.
const JOBS: Job[] = [
  {
    name: 'health-all',
    everyMs: 15 * 60 * 1000,
    run: async () => {
      const drives = await prisma.drive.findMany({ select: { id: true } });
      for (const { id } of drives) await checkDriveHealth(id);
      return { checked: drives.length };
    },
  },
  {
    name: 'sync-all',
    everyMs: 10 * 60 * 1000,
    run: async () => {
      const drives = await prisma.drive.findMany({ where: { status: { in: WRITABLE_DRIVE_STATUSES } } });
      let failed = 0;
      for (const drive of drives) {
        try {
          await syncDrive(drive);
        } catch (error) {
          failed++;
          console.warn(`Sync failed for drive ${drive.id}:`, error);
        }
      }
      return { synced: drives.length - failed, failed };
    },
  },
  {
    name: 'cleanup',
    everyMs: DAY_MS,
    run: async () => {
      // Uploads abandoned for a day: remove the file record and any chunks already stored.
      const stale = await prisma.file.findMany({
        where: { status: FILE_STATUS.uploading, created_at: { lt: new Date(Date.now() - DAY_MS) } },
        select: { id: true },
      });
      if (stale.length > 0) await removeFiles(stale.map((f) => f.id));

      // Trash older than the retention period is deleted for good.
      const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * DAY_MS);
      const owners = await prisma.file.findMany({
        where: { trash_root: true, trashed_at: { lt: cutoff } },
        distinct: ['user_id'],
        select: { user_id: true },
      });
      let purged = 0;
      for (const { user_id } of owners) {
        const count = await emptyTrash(user_id, cutoff);
        purged += count;
        await notify(user_id, {
          type: 'trash.purged',
          title: `${count} item(s) were permanently deleted from the trash`,
          body: `Items are kept in the trash for ${TRASH_RETENTION_DAYS} days.`,
        });
      }

      const shares = await prisma.shareLink.deleteMany({ where: { expires_at: { lt: new Date() } } });
      const checks = await prisma.healthCheck.deleteMany({ where: { checked_at: { lt: new Date(Date.now() - 90 * DAY_MS) } } });
      return { staleUploads: stale.length, purgedTrash: purged, expiredShares: shares.count, oldHealthChecks: checks.count };
    },
  },
];

function createConnection() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!/^rediss?:\/\//.test(url)) {
    console.warn('REDIS_URL must be a redis:// or rediss:// URL (for Upstash, use the TCP URL, not the REST URL); background jobs disabled');
    return null;
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}

export async function startWorkers() {
  const connection = createConnection();
  if (!connection) {
    console.warn('Redis not configured; health checks, sync and cleanup will not run in the background');
    return async () => {};
  }

  const queue = new Queue('maintenance', { connection });
  for (const job of JOBS) {
    await queue.upsertJobScheduler(job.name, { every: job.everyMs }, { name: job.name });
  }

  const worker = new Worker(
    'maintenance',
    async (job) => {
      const definition = JOBS.find((j) => j.name === job.name);
      if (!definition) throw new Error(`Unknown job: ${job.name}`);
      return definition.run();
    },
    { connection, concurrency: 1 }
  );
  worker.on('failed', (job, error) => console.error(`Job ${job?.name} failed:`, error));

  return async () => {
    await worker.close();
    await queue.close();
    connection.disconnect();
  };
}
