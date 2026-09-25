import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';
import './bigint-json';
import { computeChecksum } from '../services/chunking';
import { buildVirtualPath, validateName } from '../services/files';
import { contentDisposition } from '../services/file-stream';

describe('crypto', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encrypt('secret-token');
    const b = encrypt('secret-token');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('secret-token');
  });

  it('rejects tampered ciphertext', () => {
    const [iv, tag, data] = encrypt('secret-token').split(':');
    const flipped = (parseInt(data[0], 16) ^ 1).toString(16) + data.slice(1);
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });
});

describe('computeChecksum', () => {
  it('is deterministic lowercase hex and content-sensitive', async () => {
    const a = await computeChecksum(new TextEncoder().encode('hello'));
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(await computeChecksum(new TextEncoder().encode('hello'))).toBe(a);
    expect(await computeChecksum(new TextEncoder().encode('hellp'))).not.toBe(a);
  });
});

describe('BigInt JSON', () => {
  it('serializes Prisma byte counts', () => {
    expect(JSON.stringify({ size: 5n })).toBe('{"size":5}');
  });
});

describe('virtual paths and names', () => {
  it('builds paths from the parent', () => {
    expect(buildVirtualPath(null, 'a.txt')).toBe('/a.txt');
    expect(buildVirtualPath({ virtual_path: '/docs' }, 'a.txt')).toBe('/docs/a.txt');
  });

  it('rejects names that would break paths', () => {
    expect(() => validateName('a/b')).toThrow();
    expect(() => validateName('..')).toThrow();
    expect(() => validateName('   ')).toThrow();
    expect(validateName('  report.pdf ')).toBe('report.pdf');
  });
});

describe('contentDisposition', () => {
  it('escapes quotes and encodes non-ASCII names', () => {
    const header = contentDisposition('রিপোর্ট "final".pdf', 'attachment');
    expect(header).toContain('filename="');
    expect(header).not.toContain('"final"');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('রিপোর্ট "final".pdf')}`);
  });
});
