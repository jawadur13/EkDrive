import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import helmet from 'helmet';
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

const app = new Hono();

app.use('*', helmet());
app.use('*', cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use('*', logger());

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

export default app;