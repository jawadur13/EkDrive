import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRetryable, retryDelayMs, withGoogleRetry } from './google-retry';

describe('isRetryable', () => {
  it('retries throttling and server faults', () => {
    for (const code of [429, 500, 502, 503, 504]) expect(isRetryable({ code })).toBe(true);
    expect(isRetryable({ response: { status: 503 } })).toBe(true);
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ cause: { code: 'ETIMEDOUT' } })).toBe(true);
  });

  it('gives up immediately on anything repeating cannot fix', () => {
    for (const code of [400, 401, 403, 404, 409]) expect(isRetryable({ code })).toBe(false);
    expect(isRetryable(new Error('nope'))).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('honours Retry-After when Google sends one', () => {
    expect(retryDelayMs({ response: { headers: { 'retry-after': '3' } } }, 1)).toBe(3000);
    // Even a wild value stays inside the cap.
    expect(retryDelayMs({ response: { headers: { 'retry-after': '9999' } } }, 1)).toBe(20_000);
  });

  it('otherwise backs off exponentially with jitter', () => {
    const first = retryDelayMs({}, 1);
    const third = retryDelayMs({}, 3);
    expect(first).toBeGreaterThanOrEqual(500);
    expect(first).toBeLessThan(1100);
    expect(third).toBeGreaterThanOrEqual(2000);
    expect(third).toBeLessThan(2600);
  });
});

describe('withGoogleRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the first success without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withGoogleRetry('t', fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a throttled call until it succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce({ code: 429 }).mockRejectedValueOnce({ code: 503 }).mockResolvedValue('done');
    const promise = withGoogleRetry('t', fn);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops after four attempts and rethrows the last failure', async () => {
    const fn = vi.fn().mockRejectedValue({ code: 503, message: 'still down' });
    const promise = withGoogleRetry('t', fn);
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toMatchObject({ message: 'still down' });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('does not retry a permanent failure', async () => {
    const fn = vi.fn().mockRejectedValue({ code: 404 });
    await expect(withGoogleRetry('t', fn)).rejects.toMatchObject({ code: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
