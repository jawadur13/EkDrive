import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { checkDriveHealth } from '../services/drive-health';
import { triggerSync } from '../services/sync';

const prisma = new PrismaClient();

const connection = new IORedis({
  host: new URL(process.env.REDIS_URL || 'http://localhost:6379').hostname,
  port: parseInt(new URL(process.env.REDIS_URL || 'http://localhost:6379').port) || 6379,
  password: new URL(process.env.REDIS_URL || '').password || undefined,
  tls: new URL(process.env.REDIS_URL || '').protocol === 'https:' ? {} : undefined,
});

export const uploadQueue = new Queue('upload', { connection });
export const downloadQueue = new Queue('download', { connection });
export const syncQueue = new Queue('sync', { connection });
export const healthQueue = new Queue('health', { connection });
export const rebalanceQueue = new Queue('rebalance', { connection });
export const thumbnailQueue = new Queue('thumbnail', { connection });
export const cleanupQueue = new Queue('cleanup', { connection });

export async function addJob(queueName: string, data: Record<string, unknown>, options?: { delay?: number; priority?: number }) {
  const queue = getQueue(queueName);
  return queue.add(queueName, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    delay: options?.delay,
    priority: options?.priority,
  });
}

export function getQueue(name: string) {
  switch (name) {
    case 'upload': return uploadQueue;
    case 'download': return downloadQueue;
    case 'sync': return syncQueue;
    case 'health': return healthQueue;
    case 'rebalance': return rebalanceQueue;
    case 'thumbnail': return thumbnailQueue;
    case 'cleanup': return cleanupQueue;
    default: throw new Error(`Unknown queue: ${name}`);
  }
}

export async function getQueueStats() {
  const queues = [uploadQueue, downloadQueue, syncQueue, healthQueue, rebalanceQueue, thumbnailQueue, cleanupQueue];
  const stats = {};
  for (const queue of queues) {
    const counts = await queue.getJobCounts();
    stats[queue.name] = counts;
  }
  return stats;
}

export function startHealthWorker() {
  const worker = new Worker('health', async (job) => {
    const { driveId } = job.data as { driveId: string };
    return checkDriveHealth(driveId);
  }, { connection, concurrency: 2 });

  worker.on('completed', (job, result) => {
    console.log(`Health check completed for drive ${job.data.driveId}: ${result?.status}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Health check failed for drive ${job.data.driveId}:`, err.message);
  });

  return worker;
}

export function startSyncWorker() {
  const worker = new Worker('sync', async (job) => {
    const { userId } = job.data as { userId: string };
    return triggerSync(userId);
  }, { connection, concurrency: 1 });

  worker.on('completed', (job, result) => {
    console.log(`Sync completed for user ${job.data.userId}: ${result?.triggered} drives`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Sync failed for user ${job.data.userId}:`, err.message);
  });

  return worker;
}

export function startCleanupWorker() {
  const worker = new Worker('cleanup', async (job) => {
    const { type } = job.data as { type: string };

    if (type === 'orphaned_chunks') {
      const orphanedChunks = await prisma.chunk.findMany({
        where: { upload_status: 'failed' },
        take: 100,
      });

      for (const chunk of orphanedChunks) {
        try {
          const drive = await prisma.drive.findUnique({ where: { id: chunk.drive_id } });
          if (drive) {
            const tokens = await getDecryptedTokens(drive.user_id);
            if (tokens?.access_token) {
              const oauth2Client = getOAuthClient(drive.user_id);
              const driveApi = google.drive({ version: 'v3', auth: oauth2Client });
              await driveApi.files.delete({ fileId: chunk.google_file_id });
            }
          }
        } catch {
          // Continue cleanup even if one chunk fails
        }
      }

      await prisma.chunk.deleteMany({
        where: { upload_status: 'failed', created_at: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      });
    }

    if (type === 'expired_share_links') {
      await prisma.shareLink.deleteMany({
        where: { expires_at: { lt: new Date() } },
      });
    }

    if (type === 'old_health_checks') {
      await prisma.healthCheck.deleteMany({
        where: { checked_at: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      });
    }

    return { type, cleaned: true };
  }, { connection, concurrency: 1 });

  return worker;
}