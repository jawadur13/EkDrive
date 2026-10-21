import '../env';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../db/client';
import { checkDriveHealth } from '../services/drive-health';
import { syncDrive } from '../services/sync';
import { emptyTrash, FILE_STATUS, removeFiles, TRASH_RETENTION_DAYS } from '../services/files';
import { notify } from '../services/notifications';
import { WRITABLE_DRIVE_STATUSES } from '../services/drives';
import { logger } from '../utils/logger';

const DAY_MS = 24 * 60 * 60 * 1000;

type Job = {
  name: string;
  everyMs: number;
  /** Delay before the first run after boot, so a restart loop cannot hammer Google. */
  firstRunMs: number;
  run: () => Promise<unknown>;
};

// Each job runs on its own schedule. With Redis they are BullMQ repeatable jobs; without it
// they run on timers inside this process (see startWorkers).
export const JOBS: Job[] = [
  {
    name: 'health-all',
    everyMs: 15 * 60 * 1000,
    firstRunMs: 20 * 1000,
    run: async () => {
      const drives = await prisma.drive.findMany({ select: { id: true } });
      let failed = 0;
      for (const { id } of drives) {
        try {
          await checkDriveHealth(id);
        } catch (error) {
          failed++;
          logger.warn({ err: error }, `Health check failed for drive ${id}`);
        }
      }
      return { checked: drives.length - failed, failed };
    },
  },
  {
    name: 'sync-all',
    everyMs: 10 * 60 * 1000,
    firstRunMs: 60 * 1000,
    run: async () => {
      const drives = await prisma.drive.findMany({ where: { status: { in: WRITABLE_DRIVE_STATUSES } } });
      let failed = 0;
      for (const drive of drives) {
        try {
          await syncDrive(drive);
        } catch (error) {
          failed++;
          logger.warn({ err: error }, `Sync failed for drive ${drive.id}`);
        }
      }
      return { synced: drives.length - failed, failed };
    },
  },
  {
    name: 'cleanup',
    everyMs: DAY_MS,
    // Runs soon after boot: on a process that restarts often this is the only chance the
    // daily work gets, and trash that is never purged leaks Google storage.
    firstRunMs: 2 * 60 * 1000,
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
      const syncEntries = await prisma.syncEntry.deleteMany({
        where: { sync_status: { not: 'conflict' }, created_at: { lt: new Date(Date.now() - 30 * DAY_MS) } },
      });
      return {
        staleUploads: stale.length,
        purgedTrash: purged,
        expiredShares: shares.count,
        oldHealthChecks: checks.count,
        oldSyncEntries: syncEntries.count,
      };
    },
  },
];

export type JobDefinition = Job;
export type StopWorkers = () => Promise<void>;

function createConnection() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!/^rediss?:\/\//.test(url)) {
    logger.warn('REDIS_URL is not a redis:// or rediss:// URL (for Upstash, use the TCP URL, not the REST URL); falling back to the in-process scheduler'
    );
    return null;
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}

async function runJob(job: Job) {
  const startedAt = Date.now();
  try {
    const result = await job.run();
    logger.info({ detail: result }, `job ${job.name} finished in ${Date.now() - startedAt}ms`);
    return result;
  } catch (error) {
    logger.error({ err: error }, `job ${job.name} failed after ${Date.now() - startedAt}ms`);
    throw error;
  }
}

// Timers in this process. Correct for a single instance, which is what the rate limiter and
// the rebalance lock already assume; with several instances configure Redis so BullMQ runs
// each job once across the fleet.
export function startInProcessScheduler(jobs: Job[] = JOBS): StopWorkers {
  const timers: NodeJS.Timeout[] = [];
  const running = new Set<string>();

  const schedule = (job: Job) => {
    const tick = async () => {
      // A slow run must not overlap with the next tick.
      if (running.has(job.name)) {
        console.warn(`job ${job.name} is still running; skipping this tick`);
        return;
      }
      running.add(job.name);
      try {
        await runJob(job);
      } catch {
        // runJob already logged it; the next tick retries.
      } finally {
        running.delete(job.name);
      }
    };

    timers.push(setTimeout(() => {
      void tick();
      timers.push(setInterval(() => void tick(), job.everyMs));
    }, job.firstRunMs));
  };

  jobs.forEach(schedule);
  logger.info(`Background jobs scheduled in-process: ${jobs.map((j) => j.name).join(', ')}`);

  return async () => {
    for (const timer of timers) clearTimeout(timer as NodeJS.Timeout);
    timers.length = 0;
  };
}

async function startBullWorkers(connection: IORedis): Promise<StopWorkers> {
  const queue = new Queue('maintenance', { connection });
  for (const job of JOBS) {
    await queue.upsertJobScheduler(job.name, { every: job.everyMs }, { name: job.name });
  }

  const worker = new Worker(
    'maintenance',
    async (job) => {
      const definition = JOBS.find((j) => j.name === job.name);
      if (!definition) throw new Error(`Unknown job: ${job.name}`);
      return runJob(definition);
    },
    { connection, concurrency: 1 }
  );
  worker.on('failed', (job, err) => logger.error({ err, job: job?.name }, 'Job failed'));
  logger.info(`Background jobs scheduled on Redis: ${JOBS.map((j) => j.name).join(', ')}`);

  return async () => {
    await worker.close();
    await queue.close();
    connection.disconnect();
  };
}

// Redis spreads the jobs across instances and survives a restart mid-job; without it the same
// jobs still run, just inside this process.
export async function startWorkers(): Promise<StopWorkers> {
  const connection = createConnection();
  if (!connection) return startInProcessScheduler();
  try {
    return await startBullWorkers(connection);
  } catch (error) {
    console.warn('Could not reach Redis; falling back to the in-process scheduler:', error);
    connection.disconnect();
    return startInProcessScheduler();
  }
}
