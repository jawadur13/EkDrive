import { logger } from './logger';

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;
/** Never sleep longer than this on one attempt, whatever Retry-After says. */
const MAX_DELAY_MS = 20_000;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']);

export function statusOf(error: any): number | undefined {
  const code = error?.code ?? error?.response?.status;
  return typeof code === 'number' ? code : undefined;
}

export function isRetryable(error: any) {
  const status = statusOf(error);
  if (status !== undefined) return RETRYABLE_STATUSES.has(status);
  return RETRYABLE_CODES.has(error?.code) || RETRYABLE_CODES.has(error?.cause?.code);
}

/** Google answers a throttled request with the seconds to wait; honour it when it is sane. */
export function retryDelayMs(error: any, attempt: number) {
  const header = error?.response?.headers?.['retry-after'] ?? error?.response?.headers?.get?.('retry-after');
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_DELAY_MS);

  // Exponential, with jitter so a batch of chunks does not retry in lockstep.
  const backoff = BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(backoff + Math.random() * BASE_DELAY_MS, MAX_DELAY_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries the transient failures Google hands out under load — 429 and 5xx — and the network
 * errors that look the same from here. Anything else (a missing file, a refused credential)
 * is returned to the caller straight away, since repeating it changes nothing.
 */
export async function withGoogleRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
      const delay = retryDelayMs(error, attempt);
      logger.warn({ label, attempt, delay, status: statusOf(error) }, 'Google call failed; retrying');
      await sleep(delay);
    }
  }
}
