import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';

type RequestContext = { requestId: string; userId?: string };

// Carries the request id down through services, so a log line written deep in a chunk upload
// can still be tied back to the request that caused it without passing it through every call.
const store = new AsyncLocalStorage<RequestContext>();

const base = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  // A secret that reaches a log line is a secret that leaks; redact the usual carriers.
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'access_token', 'refresh_token', '*.oauth_token_encrypted'],
    censor: '[redacted]',
  },
  formatters: { level: (label) => ({ level: label }) },
});

function withContext() {
  const context = store.getStore();
  return context ? base.child(context) : base;
}

export const logger = {
  debug: (...args: Parameters<pino.Logger['debug']>) => withContext().debug(...args),
  info: (...args: Parameters<pino.Logger['info']>) => withContext().info(...args),
  warn: (...args: Parameters<pino.Logger['warn']>) => withContext().warn(...args),
  error: (...args: Parameters<pino.Logger['error']>) => withContext().error(...args),
};

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return store.run(context, fn);
}

export function setRequestUser(userId: string) {
  const context = store.getStore();
  if (context) context.userId = userId;
}

export function currentRequestId() {
  return store.getStore()?.requestId;
}
