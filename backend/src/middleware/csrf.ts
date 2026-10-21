import { env } from '../env';
import { HttpError } from '../utils/errors';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// A cross-site form post cannot set Origin to our own site, and browsers always send Origin on
// state-changing requests. Together with the SameSite=Strict session cookie this is what stops
// another page from acting as the signed-in user. Requests that carry a bearer token instead of
// the cookie are not reachable this way, so they are left alone (curl, tests, future clients).
export async function requireSameOrigin(c: any, next: any) {
  if (SAFE_METHODS.includes(c.req.method) || c.req.header('Authorization')?.startsWith('Bearer ')) {
    await next();
    return;
  }

  const origin = c.req.header('Origin');
  const allowed = [env.frontendUrl, env.backendUrl];

  if (!origin) {
    // No Origin at all: not a browser request, and without a cookie it cannot be a CSRF.
    if (!c.req.header('Cookie')) {
      await next();
      return;
    }
    throw new HttpError(403, 'ORIGIN_REQUIRED', 'This request needs an Origin header');
  }

  if (!allowed.includes(origin)) {
    throw new HttpError(403, 'BAD_ORIGIN', 'Request came from an unexpected origin');
  }

  await next();
}
