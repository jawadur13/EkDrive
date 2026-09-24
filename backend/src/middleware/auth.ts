import { env } from '../env';
import { getCookie } from 'hono/cookie';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/client';

export const SESSION_COOKIE = 'access_token';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const PUBLIC_PATHS = ['/api/v1/auth/login', '/api/v1/auth/callback'];
const PUBLIC_PREFIXES = ['/api/v1/shares/public/'];

export async function authenticateUser(c: any, next: any) {
  const path: string = c.req.path;
  if (PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    await next();
    return;
  }

  const authHeader: string | undefined = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : getCookie(c, SESSION_COOKIE);

  if (!token) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  let userId: string;
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as { sub?: string; type?: string };
    if (decoded.type !== 'session' || !decoded.sub) throw new Error('Not a session token');
    userId = decoded.sub;
  } catch {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'User not found' } }, 401);
  }

  c.set('userId', user.id);
  c.set('user', user);
  await next();
}
