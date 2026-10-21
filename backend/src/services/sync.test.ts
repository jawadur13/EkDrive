import { describe, expect, it } from 'vitest';
import { isExpiredPageToken } from './sync';

describe('isExpiredPageToken', () => {
  it('recognises the shapes Google uses for a stale token', () => {
    expect(isExpiredPageToken({ code: 410 })).toBe(true);
    expect(isExpiredPageToken({ code: 400 })).toBe(true);
    expect(isExpiredPageToken({ response: { status: 410 } })).toBe(true);
    expect(isExpiredPageToken({ errors: [{ reason: 'pageTokenInvalid' }] })).toBe(true);
  });

  it('leaves other failures alone, so they surface instead of resetting the watch', () => {
    expect(isExpiredPageToken({ code: 401 })).toBe(false);
    expect(isExpiredPageToken({ code: 500 })).toBe(false);
    expect(isExpiredPageToken(new Error('socket hang up'))).toBe(false);
    expect(isExpiredPageToken(undefined)).toBe(false);
  });
});
