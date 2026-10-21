import { randomUUID } from 'node:crypto';
import { logger, runWithRequestContext } from '../utils/logger';

/** Anything slower than this is logged at warn level, so the slow paths stand out. */
const SLOW_MS = 2000;

// One line per request, with an id that is also returned in X-Request-Id so a user can quote
// it and the matching log line can be found.
export async function requestLogger(c: any, next: any) {
  const requestId = c.req.header('x-request-id') ?? randomUUID();
  const startedAt = Date.now();
  c.header('X-Request-Id', requestId);

  await runWithRequestContext({ requestId }, async () => {
    try {
      await next();
    } finally {
      const durationMs = Date.now() - startedAt;
      const line = {
        method: c.req.method,
        path: c.req.path,
        status: c.res?.status,
        durationMs,
        userId: c.get?.('userId'),
      };
      if (line.status >= 500) logger.error(line, 'request failed');
      else if (durationMs > SLOW_MS) logger.warn(line, 'slow request');
      else logger.info(line, 'request');
    }
  });
}
