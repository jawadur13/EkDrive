import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOBS, startInProcessScheduler, type JobDefinition } from './queue';

describe('job definitions', () => {
  it('every job has a sane schedule', () => {
    expect(JOBS.map((j) => j.name)).toEqual(['health-all', 'sync-all', 'cleanup']);
    for (const job of JOBS) {
      expect(job.everyMs).toBeGreaterThanOrEqual(60_000);
      // The first run is delayed so a crash loop cannot hammer Google.
      expect(job.firstRunMs).toBeGreaterThanOrEqual(10_000);
      expect(job.firstRunMs).toBeLessThan(job.everyMs);
    }
  });
});

describe('in-process scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const job = (name: string, run: () => Promise<unknown>): JobDefinition => ({
    name,
    everyMs: 1000,
    firstRunMs: 100,
    run,
  });

  it('runs after the initial delay, then on the interval, and stops when told', async () => {
    const run = vi.fn(async () => 'ok');
    const stop = startInProcessScheduler([job('a', run)]);

    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(3);

    await stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('skips a tick while the previous run is still going', async () => {
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const stop = startInProcessScheduler([job('slow', run)]);

    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);

    // Three intervals pass while the first run is still in flight.
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    await stop();
  });

  it('keeps running after a job throws', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = startInProcessScheduler([job('flaky', run)]);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    await stop();
  });
});
