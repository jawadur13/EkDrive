import jwt from 'jsonwebtoken';
import { prisma } from '../db/client';

const JWT_SECRET = process.env.JWT_SECRET as string;

export async function authenticateUser(c: any, next: any) {
  const publicPaths = ['/api/v1/auth/login', '/api/v1/auth/callback', '/api/v1/auth/connect'];
  if (publicPaths.includes(c.req.path)) {
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  const cookieHeader = c.req.header('Cookie');

  let token = null;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (cookieHeader) {
    const match = cookieHeader.match(/access_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });

    if (!user) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'User not found' } }, 401);
    }

    c.set('userId', user.id);
    c.set('user', user);
    await next();
  } catch {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }
}

export function getUserFromContext(c: any): string | null {
  return c.get('userId') || null;
}
