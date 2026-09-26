import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(15 * 1024 ** 3)).toBe('15 GB');
  });
});
