import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../db/client';
import { google } from 'googleapis';
import { checkDriveHealth } from '../services/drive-health';
import { triggerSync } from '../services/sync';
import { createAuthenticatedDriveClient } from '../utils/drive-auth';

let connection: IORedis | null = null;
try {
  const redisUrl = process.env.REDIS_URL || '';
  if (redisUrl && !redisUrl.startsWith('http')) {
    connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 100, 5000),
    });
  } else if (redisUrl.startsWith('http')) {
    connection = new IORedis({
      host: new URL(redisUrl).hostname,
      port: 6379,
      password: process.env.REDIS_REST_TOKEN || undefined,
      tls: {},
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 100, 5000),
    });
  }
} catch {
  console.warn('Redis unavailable, background workers will be disabled');
}

function createQueue(name: string) {
  return connection ? new Queue(name, { connection }) : null;
}

function createWorker<T>(name: string, processor: (job: any) => Promise<T>) {
  return connection ? new Worker(name, processor, { connection, concurrency: 2 }) : null;
}

export const uploadQueue = createQueue('upload');
export const downloadQueue = createQueue('download');
export const syncQueue = createQueue('sync');
export const healthQueue = createQueue('health');
export const rebalanceQueue = createQueue('rebalance');
export const thumbnailQueue = createQueue('thumbnail');
export const cleanupQueue = createQueue('cleanup');

export async function addJob(queueName: string, data: Record<string, unknown>, options?: { delay?: number; priority?: number }) {
  const queue = getQueue(queueName);
  if (!queue) throw new Error('Redis not available');
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
  const stats: Record<string, unknown> = {};
  for (const q of queues) {
    if (q) {
      const counts = await q.getJobCounts();
      stats[q.name] = counts;
    }
  }
  return stats;
}

export function startHealthWorker() {
  if (!connection) return null;
  return createWorker('health', async (job) => {
    const { driveId } = job.data as { driveId: string };
    return checkDriveHealth(driveId);
  });
}

export function startSyncWorker() {
  if (!connection) return null;
  return createWorker('sync', async (job) => {
    const { userId } = job.data as { userId: string };
    return triggerSync(userId);
  });
}

export function startCleanupWorker() {
  if (!connection) return null;
  return createWorker('cleanup', async (job) => {
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
            const { client, tokens } = await createAuthenticatedDriveClient(drive.user_id);
            if (tokens?.access_token) {
              const driveApi = google.drive({ version: 'v3', auth: client as any });
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
  });
}
