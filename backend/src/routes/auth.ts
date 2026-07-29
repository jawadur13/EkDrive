import { Hono } from 'hono';
import { z } from 'zod';

export const authRoutes = new Hono();

const loginSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 422);
  }
  return c.json({ message: 'Login endpoint — OAuth flow handles authentication' });
});

authRoutes.get('/me', async (c) => {
  return c.json({ user: null });
});

authRoutes.post('/logout', async (c) => {
  return c.json({ message: 'Logged out' });
});