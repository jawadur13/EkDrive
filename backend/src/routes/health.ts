import { Hono } from 'hono';
import { getAllDriveHealth } from '../services/drive-health';

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

healthRoutes.get('/drives', async (c) => {
  const userId = (c as any).get('userId') as string;
  const drives = await getAllDriveHealth(userId);
  return c.json({ drives });
});
