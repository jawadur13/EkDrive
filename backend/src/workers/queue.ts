import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

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

export async function addJob(queueName: string, data: Record<string, unknown>, options?: { delay?: number; priority?: number }) {
  const queue = getQueue(queueName);
  return queue.add(queueName, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    delay: options?.delay,
    priority: options?.priority,
  });
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