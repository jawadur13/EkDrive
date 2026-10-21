// Must stay the first import: loads .env.local before any other module reads process.env.
import { env } from './env';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import { authenticateUser } from './middleware/auth';
import { requireSameOrigin } from './middleware/csrf';
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
import { trashRoutes } from './routes/trash';
import { activityRoutes, analyticsRoutes, notificationRoutes } from './routes/insights';
import { HttpError } from './utils/errors';
import './utils/bigint-json';

export const app = new Hono();

app.use(
  '*',
  secureHeaders({
    // The API serves JSON and file bytes, never HTML of its own, so nothing may be loaded or
    // framed. Inline previews relax this per response in services/file-stream.ts.
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
    crossOriginResourcePolicy: 'same-site',
  })
);
app.use('*', cors({ origin: env.frontendUrl, credentials: true, maxAge: 3600 }));
if (process.env.NODE_ENV !== 'test') app.use('*', logger());

// Before auth, so an unauthenticated flood is counted per IP.
app.use('/api/v1/auth/*', rateLimit({ bucket: 'auth' }));
app.use('/api/v1/shares/public/*', rateLimit({ bucket: 'public-share' }));

// JSON bodies are small; chunk uploads set their own limit in routes/upload.ts.
app.use('/api/v1/*', async (c, next) => {
  if (/^\/api\/v1\/upload\/[^/]+\/chunk\//.test(c.req.path)) return next();
  return bodyLimit({ maxSize: 1024 * 1024 })(c, next);
});

app.use('/api/v1/*', authenticateUser);
app.use('/api/v1/*', requireSameOrigin);

// After auth, so the budgets below are per user. Chunk uploads and file reads are allowed to
// be chatty; the jobs that move data between Google accounts are not.
app.use('/api/v1/*', rateLimit({ bucket: 'api', max: env.rateLimitMax }));
app.use('/api/v1/upload/*', rateLimit({ bucket: 'upload', max: env.rateLimitMax * 10 }));
app.use('/api/v1/files/*', rateLimit({ bucket: 'files', max: env.rateLimitMax * 5 }));
app.use('/api/v1/storage-mode/rebalance', rateLimit({ bucket: 'rebalance', max: 5 }));
app.use('/api/v1/sync/trigger', rateLimit({ bucket: 'sync', max: 10 }));

app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/files', fileRoutes);
app.route('/api/v1/files', downloadRoutes);
app.route('/api/v1/drives', driveRoutes);
app.route('/api/v1/storage-mode', storageModeRoutes);
app.route('/api/v1/sync', syncRoutes);
app.route('/api/v1/shares', shareRoutes);
app.route('/api/v1/health', healthRoutes);
app.route('/api/v1/upload', uploadRoutes);
app.route('/api/v1/trash', trashRoutes);
app.route('/api/v1/activity', activityRoutes);
app.route('/api/v1/notifications', notificationRoutes);
app.route('/api/v1/analytics', analyticsRoutes);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof HTTPException) {
    const code = error.status === 413 ? 'PAYLOAD_TOO_LARGE' : `HTTP_${error.status}`;
    return c.json({ error: { code, message: error.message || 'Request rejected' } }, error.status);
  }
  console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, error);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500);
});

