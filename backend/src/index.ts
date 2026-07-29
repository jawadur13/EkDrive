import dotenv from 'dotenv';
dotenv.config({ path: '../.env.local' });
dotenv.config();
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { authenticateUser } from './middleware/auth';
import { rateLimit } from './middleware/rate-limit';
import { authRoutes } from './routes/auth';
import { fileRoutes } from './routes/files';
import { driveRoutes } from './routes/drives';
import { storageModeRoutes } from './routes/storage-mode';
import { syncRoutes } from './routes/sync';
import { shareRoutes } from './routes/shares';
import { healthRoutes } from './routes/health';
import { uploadRoutes } from './routes/upload';
import { downloadRoutes } from './routes/download';
import { previewRoutes } from './routes/preview';
import { startHealthWorker, startSyncWorker, startCleanupWorker } from './workers/queue';

const app = new Hono();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error('FATAL: ENCRYPTION_KEY environment variable is required');
  process.exit(1);
}

app.use('*', secureHeaders());
app.use('*', cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use('*', logger());

app.use('/api/v1/auth/*', rateLimit());
app.use('/api/v1/upload/*', rateLimit());

app.use('/api/v1/*', authenticateUser);

app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/files', fileRoutes);
app.route('/api/v1/drives', driveRoutes);
app.route('/api/v1/storage-mode', storageModeRoutes);
app.route('/api/v1/sync', syncRoutes);
app.route('/api/v1/shares', shareRoutes);
app.route('/api/v1/health', healthRoutes);
app.route('/api/v1/upload', uploadRoutes);
app.route('/api/v1/files', downloadRoutes);
app.route('/api/v1/files', previewRoutes);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

const port = parseInt(process.env.PORT || '3000');

serve({ fetch: app.fetch, port });

try {
  startHealthWorker();
  startSyncWorker();
  startCleanupWorker();
  console.log('Background workers started');
} catch (error) {
  console.warn('Failed to start background workers (Redis may be unavailable):', error);
}

console.log(`EkDrive backend running on http://localhost:${port}`);
