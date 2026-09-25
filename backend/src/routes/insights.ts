import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../middleware/validation';
import { listActivity } from '../services/activity';
import { getAnalytics } from '../services/analytics';
import { listNotifications, markNotificationsRead } from '../services/notifications';

// Read-mostly views over the user's account: activity log, notifications, analytics.

export const activityRoutes = new Hono();

activityRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const limit = parseInt(c.req.query('limit') || '50') || 50;
  return c.json(await listActivity(userId, c.req.query('cursor') || null, limit));
});

export const notificationRoutes = new Hono();

notificationRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  return c.json(await listNotifications(userId));
});

const markReadSchema = z.object({ ids: z.array(z.string().uuid()).max(100).optional() }).nullish();

// Body { ids } marks those; an empty body marks everything read.
notificationRoutes.post('/read', async (c) => {
  const userId = (c as any).get('userId') as string;
  const body = await parseBody(c, markReadSchema);
  return c.json({ updated: await markNotificationsRead(userId, body?.ids) });
});

export const analyticsRoutes = new Hono();

analyticsRoutes.get('/', async (c) => {
  const userId = (c as any).get('userId') as string;
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30') || 30, 7), 365);
  return c.json(await getAnalytics(userId, days));
});
