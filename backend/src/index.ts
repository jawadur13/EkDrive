// Must stay the first import: loads .env.local before any other module reads process.env.
import { assertEnv, env } from './env';
import { serve } from '@hono/node-server';
import { app } from './app';
import { startWorkers } from './workers/queue';
import { prisma } from './db/client';
import { logger } from './utils/logger';

assertEnv();

const server = serve({ fetch: app.fetch, port: env.port }, () => {
  logger.info({ port: env.port, url: env.backendUrl }, 'EkDrive backend started');
});

const stopWorkers = await startWorkers().catch((error) => {
  logger.warn({ err: error }, 'Failed to start background workers');
  return async () => {};
});

async function shutdown() {
  server.close();
  await stopWorkers();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
