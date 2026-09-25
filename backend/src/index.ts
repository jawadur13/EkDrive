// Must stay the first import: loads .env.local before any other module reads process.env.
import { assertEnv, env } from './env';
import { serve } from '@hono/node-server';
import { app } from './app';
import { startWorkers } from './workers/queue';
import { prisma } from './db/client';

assertEnv();

const server = serve({ fetch: app.fetch, port: env.port }, () => {
  console.log(`EkDrive backend running on http://localhost:${env.port}`);
});

const stopWorkers = await startWorkers().catch((error) => {
  console.warn('Failed to start background workers:', error);
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
