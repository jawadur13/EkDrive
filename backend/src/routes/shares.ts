import { Hono } from 'hono';

export const shareRoutes = new Hono();

shareRoutes.get('/', async (c) => {
  return c.json({ shares: [] });
});

shareRoutes.post('/', async (c) => {
  return c.json({ id: 'placeholder-uuid', token: 'placeholder-token', message: 'Share link created' }, 201);
});

shareRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');
  return c.json({ token, fileId: 'placeholder' });
});

shareRoutes.delete('/:shareId', async (c) => {
  const shareId = c.req.param('shareId');
  return c.json({ id: shareId, message: 'Share link revoked' });
});