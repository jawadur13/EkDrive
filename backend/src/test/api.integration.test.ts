import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

// End-to-end through the HTTP layer against the real database. Google Drive is replaced by
// an in-memory blob store, so placement, checksums, replicas and reassembly all run for real.
vi.mock('../services/chunk-store', () => {
  const blobs = new Map<string, Uint8Array>();
  let counter = 0;
  return {
    __blobs: blobs,
    uploadChunkToDrive: vi.fn(async (_drive: unknown, _name: string, data: Uint8Array) => {
      const id = `fake-${++counter}-${Math.random().toString(36).slice(2)}`;
      blobs.set(id, new Uint8Array(data));
      return id;
    }),
    downloadChunkFromDrive: vi.fn(async (_drive: unknown, id: string) => {
      const data = blobs.get(id);
      if (!data) throw new Error(`blob ${id} missing`);
      return data;
    }),
    deleteChunkFromDrive: vi.fn(async (_drive: unknown, id: string) => {
      blobs.delete(id);
    }),
  };
});

// Small chunks so a few KB exercises multi-chunk files. Must be set before the app loads.
process.env.CHUNK_SIZE_BYTES = '1024';
process.env.NODE_ENV = 'test';

const { app } = await import('../app');
const { prisma } = await import('../db/client');
const { env } = await import('../env');
const { encrypt } = await import('../utils/crypto');
const { computeChecksum } = await import('../services/chunking');
const chunkStore = (await import('../services/chunk-store')) as any;
const jwt = (await import('jsonwebtoken')).default;

const RUN = randomBytes(4).toString('hex');
const userIds: string[] = [];

async function createUser(label: string, driveCount: number, quota = 10_000) {
  const user = await prisma.user.create({ data: { email: `it-${RUN}-${label}@ekdrive.test`, display_name: label } });
  userIds.push(user.id);
  for (let i = 0; i < driveCount; i++) {
    await prisma.drive.create({
      data: {
        user_id: user.id,
        drive_name: `${label}-drive-${i}`,
        google_email: `${label}-${i}@example.test`,
        google_drive_id: `it-${RUN}-${label}-${i}`,
        root_folder_id: 'root',
        oauth_token_encrypted: encrypt('fake-access-token'),
        total_quota_bytes: BigInt(quota),
        used_quota_bytes: 0n,
        available_quota_bytes: BigInt(quota),
      },
    });
  }
  const token = jwt.sign({ sub: user.id, type: 'session' }, env.jwtSecret, { expiresIn: 600 });
  return { user, token };
}

function client(token?: string) {
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const init: RequestInit = { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } };
    if (body instanceof Uint8Array) {
      init.body = body as BodyInit;
      (init.headers as Record<string, string>)['Content-Type'] = 'application/octet-stream';
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
    return app.request(`/api/v1${path}`, init);
  };
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => call('POST', p, b, h),
    put: (p: string, b?: unknown) => call('PUT', p, b),
    patch: (p: string, b?: unknown) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p),
  };
}

async function upload(api: ReturnType<typeof client>, data: Uint8Array, name: string, parentFolderId?: string) {
  const init = await api.post('/upload/init', { name, sizeBytes: data.byteLength, mimeType: 'application/octet-stream', parentFolderId });
  expect(init.status).toBe(201);
  const { fileId, chunkSize, chunkCount } = (await init.json()) as { fileId: string; chunkSize: number; chunkCount: number };
  for (let i = 0; i < chunkCount; i++) {
    const chunk = data.subarray(i * chunkSize, (i + 1) * chunkSize);
    const res = await api.post(`/upload/${fileId}/chunk/${i}`, chunk, { 'x-chunk-checksum': await computeChecksum(chunk) });
    expect(res.status).toBe(200);
  }
  const done = await api.post(`/upload/${fileId}/complete`, {});
  expect(done.status).toBe(200);
  return { fileId, chunkCount };
}

function groupByIndex<T extends { chunk_index: number }>(chunks: T[]) {
  const map = new Map<number, T[]>();
  for (const c of chunks) map.set(c.chunk_index, [...(map.get(c.chunk_index) ?? []), c]);
  return map;
}

let owner: Awaited<ReturnType<typeof createUser>>;
let other: Awaited<ReturnType<typeof createUser>>;
let api: ReturnType<typeof client>;

beforeAll(async () => {
  owner = await createUser('owner', 3);
  other = await createUser('other', 1);
  api = client(owner.token);
});

afterAll(async () => {
  const where = { user_id: { in: userIds } };
  const files = await prisma.file.findMany({ where, select: { id: true } });
  const fileIds = files.map((f) => f.id);
  await prisma.$transaction([
    prisma.activity.deleteMany({ where }),
    prisma.notification.deleteMany({ where }),
    prisma.shareLink.deleteMany({ where }),
    prisma.syncEntry.deleteMany({ where }),
    prisma.chunk.deleteMany({ where: { file_id: { in: fileIds } } }),
    prisma.file.updateMany({ where, data: { parent_id: null } }),
    prisma.file.deleteMany({ where }),
    prisma.healthCheck.deleteMany({ where }),
    prisma.drive.deleteMany({ where }),
    prisma.storageMode.deleteMany({ where }),
    prisma.authToken.deleteMany({ where }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  await prisma.$disconnect();
});

describe('auth', () => {
  it('returns the session user', async () => {
    const res = await api.get('/auth/me');
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).user.email).toBe(owner.user.email);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = jwt.sign({ sub: owner.user.id, type: 'session' }, 'wrong-secret');
    expect((await client(forged).get('/auth/me')).status).toBe(401);
  });

  it('lists drives without exposing tokens', async () => {
    const body = (await (await api.get('/drives')).json()) as any;
    expect(body.drives).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain('oauth_token');
    expect(typeof body.drives[0].total_quota_bytes).toBe('number');
  });
});

describe('folders', () => {
  let a: any;
  let b: any;

  it('creates nested folders with virtual paths', async () => {
    a = await (await api.post('/files', { name: 'Docs' })).json();
    b = await (await api.post('/files', { name: 'Inner', parentFolderId: a.id })).json();
    expect(a.virtual_path).toBe('/Docs');
    expect(b.virtual_path).toBe('/Docs/Inner');

    const crumbs = (await (await api.get(`/files/${b.id}/breadcrumbs`)).json()) as any;
    expect(crumbs.breadcrumbs.map((c: any) => c.name)).toEqual(['Docs', 'Inner']);
  });

  it('lists root with folders first', async () => {
    const res = await api.get('/files');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.files.some((f: any) => f.id === a.id)).toBe(true);
  });

  it('renaming a folder rewrites paths below it', async () => {
    expect((await api.patch(`/files/${a.id}`, { name: 'Papers' })).status).toBe(200);
    const inner = (await (await api.get(`/files/${b.id}`)).json()) as any;
    expect(inner.virtual_path).toBe('/Papers/Inner');
  });

  it('refuses to move a folder into itself', async () => {
    expect((await api.patch(`/files/${a.id}`, { parentFolderId: b.id })).status).toBe(409);
  });

  it('rejects fields other than name and parent', async () => {
    expect((await api.patch(`/files/${a.id}`, { user_id: other.user.id })).status).toBe(422);
  });

  it('finds folders by name', async () => {
    const body = (await (await api.get('/files/search?q=inner')).json()) as any;
    expect(body.results.map((r: any) => r.id)).toContain(b.id);
  });

  it('returns 404, not 500, for a malformed id', async () => {
    expect((await api.get('/files/not-a-uuid/download')).status).toBe(404);
  });
});

describe('upload and download', () => {
  it('balanced mode spreads chunks and reassembles the exact bytes', async () => {
    const data = new Uint8Array(randomBytes(2500));
    const { fileId, chunkCount } = await upload(api, data, 'random.bin');
    expect(chunkCount).toBe(3);

    const chunks = await prisma.chunk.findMany({ where: { file_id: fileId } });
    expect(new Set(chunks.map((c) => c.drive_id)).size).toBeGreaterThan(1);

    const res = await api.get(`/files/${fileId}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(data))).toBe(true);
  });

  it('rejects a chunk whose checksum does not match', async () => {
    const init = (await (await api.post('/upload/init', { name: 'bad.bin', sizeBytes: 10 })).json()) as any;
    const res = await api.post(`/upload/${init.fileId}/chunk/0`, new Uint8Array(10), { 'x-chunk-checksum': 'deadbeef' });
    expect(res.status).toBe(400);
    expect((await api.post(`/upload/${init.fileId}/complete`, {})).status).toBe(409);
    expect((await api.del(`/upload/${init.fileId}`)).status).toBe(200);
  });

  it('refuses files larger than the pool', async () => {
    const res = await api.post('/upload/init', { name: 'huge.bin', sizeBytes: 1_000_000 });
    expect(res.status).toBe(507);
  });

  it('high reliability keeps two copies and survives losing one', async () => {
    expect((await api.put('/storage-mode', { mode: 'high_reliability' })).status).toBe(200);
    const data = new Uint8Array(randomBytes(1500));
    const { fileId } = await upload(api, data, 'safe.bin');

    const chunks = await prisma.chunk.findMany({ where: { file_id: fileId } });
    const byIndex = groupByIndex(chunks);
    for (const copies of byIndex.values()) {
      expect(new Set(copies.map((c) => c.drive_id)).size).toBe(2);
    }

    // Lose the first copy of every chunk on "Google".
    for (const copies of byIndex.values()) chunkStore.__blobs.delete(copies[0].google_file_id);

    const res = await api.get(`/files/${fileId}/download`);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(data))).toBe(true);
    await api.put('/storage-mode', { mode: 'balanced' });
  });
});

describe('isolation between users', () => {
  it('another user cannot see or download the file', async () => {
    const { fileId } = await upload(api, new Uint8Array(randomBytes(100)), 'private.bin');
    const intruder = client(other.token);
    expect((await intruder.get(`/files/${fileId}`)).status).toBe(404);
    expect((await intruder.get(`/files/${fileId}/download`)).status).toBe(404);
    expect((await intruder.del(`/files/${fileId}`)).status).toBe(404);
    expect((await intruder.post('/shares', { fileId })).status).toBe(404);
  });
});

describe('share links', () => {
  it('serves content without a session and enforces the download limit', async () => {
    const data = new Uint8Array(randomBytes(300));
    const { fileId } = await upload(api, data, 'shared.bin');
    const share = (await (await api.post('/shares', { fileId, maxDownloads: 1 })).json()) as any;

    const anon = client();
    const meta = await anon.get(`/shares/public/${share.token}`);
    expect(meta.status).toBe(200);

    const first = await anon.get(`/shares/public/${share.token}/content?download=1`);
    expect(first.status).toBe(200);
    expect(Buffer.from(await first.arrayBuffer()).equals(Buffer.from(data))).toBe(true);

    expect((await anon.get(`/shares/public/${share.token}/content`)).status).toBe(410);
  });

  it('does not share folders', async () => {
    const folder = (await (await api.post('/files', { name: `f-${randomUUID()}` })).json()) as any;
    expect((await api.post('/shares', { fileId: folder.id })).status).toBe(400);
  });
});

describe('trash', () => {
  it('trashing hides a folder tree, restore brings it back, purge deletes remote chunks', async () => {
    const folder = (await (await api.post('/files', { name: 'ToDelete' })).json()) as any;
    const { fileId } = await upload(api, new Uint8Array(randomBytes(2000)), 'inside.bin', folder.id);
    const blobIds = (await prisma.chunk.findMany({ where: { file_id: fileId } })).map((c) => c.google_file_id);

    expect((await api.del(`/files/${folder.id}`)).status).toBe(200);
    expect((await api.get(`/files/${fileId}`)).status).toBe(404);
    expect((await api.get(`/files/${fileId}/download`)).status).toBe(404);
    const trash = (await (await api.get('/trash')).json()) as any;
    expect(trash.items.map((i: any) => i.id)).toEqual(expect.arrayContaining([folder.id]));
    expect(trash.items.map((i: any) => i.id)).not.toContain(fileId);
    expect(blobIds.every((id) => chunkStore.__blobs.has(id))).toBe(true);

    expect((await api.post(`/trash/${folder.id}/restore`)).status).toBe(200);
    expect((await api.get(`/files/${fileId}`)).status).toBe(200);

    await api.del(`/files/${folder.id}`);
    expect((await api.del(`/trash/${folder.id}`)).status).toBe(200);
    expect(await prisma.file.count({ where: { id: { in: [folder.id, fileId] } } })).toBe(0);
    expect(blobIds.some((id) => chunkStore.__blobs.has(id))).toBe(false);
  });

  it('restores to the root when the original folder is gone', async () => {
    const parent = (await (await api.post('/files', { name: 'Parent' })).json()) as any;
    const child = (await (await api.post('/files', { name: 'Child', parentFolderId: parent.id })).json()) as any;
    await api.del(`/files/${child.id}`);
    await api.del(`/files/${parent.id}`);
    await api.del(`/trash/${parent.id}`);

    const restored = (await (await api.post(`/trash/${child.id}/restore`)).json()) as any;
    expect(restored.parent_id).toBeNull();
    expect(restored.virtual_path).toBe('/Child');
  });
});

describe('range requests', () => {
  it('serves byte ranges that span chunk boundaries', async () => {
    const data = new Uint8Array(randomBytes(3000));
    const { fileId } = await upload(api, data, 'video.bin');

    const res = await app.request(`/api/v1/files/${fileId}/preview`, {
      headers: { Authorization: `Bearer ${owner.token}`, Range: 'bytes=1000-2100' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 1000-2100/3000');
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(data.subarray(1000, 2101)))).toBe(true);

    const tail = await app.request(`/api/v1/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${owner.token}`, Range: 'bytes=-10' },
    });
    expect(Buffer.from(await tail.arrayBuffer()).equals(Buffer.from(data.subarray(2990)))).toBe(true);

    const bad = await app.request(`/api/v1/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${owner.token}`, Range: 'bytes=5000-' },
    });
    expect(bad.status).toBe(416);
  });
});

describe('repair and rebalance', () => {
  it('rebuilds a lost copy from the remaining one', async () => {
    await api.put('/storage-mode', { mode: 'high_reliability' });
    const data = new Uint8Array(randomBytes(1500));
    const { fileId } = await upload(api, data, 'repair.bin');
    await api.put('/storage-mode', { mode: 'balanced' });

    // Simulate sync finding a copy deleted on Google.
    const victim = (await prisma.chunk.findMany({ where: { file_id: fileId, chunk_index: 0 } }))[0];
    chunkStore.__blobs.delete(victim.google_file_id);
    await prisma.chunk.update({ where: { id: victim.id }, data: { upload_status: 'missing' } });

    const result = (await (await api.post(`/files/${fileId}/repair`)).json()) as any;
    expect(result.copiesAdded).toBe(1);
    expect(result.lostChunks).toEqual([]);
    const copies = await prisma.chunk.findMany({ where: { file_id: fileId, chunk_index: 0, upload_status: 'uploaded' } });
    expect(new Set(copies.map((c) => c.drive_id)).size).toBe(2);
    const res = await api.get(`/files/${fileId}/download`);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(data))).toBe(true);
  });

  it('applies a new storage mode to existing files', async () => {
    const { rebalanceUser } = await import('../services/replication');
    const { fileId } = await upload(api, new Uint8Array(randomBytes(2048)), 'mode.bin');
    expect(await prisma.chunk.count({ where: { file_id: fileId } })).toBe(2);

    await api.put('/storage-mode', { mode: 'high_reliability' });
    const up = await rebalanceUser(owner.user.id);
    expect(up.copiesAdded).toBeGreaterThanOrEqual(2);
    expect(await prisma.chunk.count({ where: { file_id: fileId } })).toBe(4);

    await api.put('/storage-mode', { mode: 'max_capacity' });
    await rebalanceUser(owner.user.id);
    expect(await prisma.chunk.count({ where: { file_id: fileId } })).toBe(2);
    await api.put('/storage-mode', { mode: 'balanced' });
  });
});

describe('activity, notifications, analytics', () => {
  it('records what the user did', async () => {
    const body = (await (await api.get('/activity?limit=100')).json()) as any;
    const actions = new Set(body.items.map((i: any) => i.action));
    for (const action of ['folder.created', 'file.uploaded', 'file.renamed', 'file.trashed', 'file.restored', 'file.deleted', 'share.created', 'share.accessed', 'storage_mode.changed', 'file.repaired']) {
      expect(actions).toContain(action);
    }
  });

  it('lists notifications, de-duplicates them and marks them read', async () => {
    const { notify } = await import('../services/notifications');
    await notify(owner.user.id, { type: 'drive.offline', severity: 'error', title: 'Test drive is unreachable' });
    await notify(owner.user.id, { type: 'drive.offline', severity: 'error', title: 'Test drive is unreachable' });
    let body = (await (await api.get('/notifications')).json()) as any;
    expect(body.items.filter((n: any) => n.title === 'Test drive is unreachable')).toHaveLength(1);
    expect(body.unread).toBeGreaterThanOrEqual(1);

    expect((await api.post('/notifications/read', {})).status).toBe(200);
    body = (await (await api.get('/notifications')).json()) as any;
    expect(body.unread).toBe(0);
  });

  it('summarises storage', async () => {
    const res = await api.get('/analytics');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.totals.files).toBeGreaterThan(0);
    expect(body.totals.storedBytes).toBeGreaterThanOrEqual(body.totals.logicalBytes);
    expect(body.drives).toHaveLength(3);
    expect(body.timeline).toHaveLength(30);
    expect(body.timeline.at(-1).files).toBeGreaterThan(0);
    expect(body.byType.find((t: any) => t.type === 'Other')?.files).toBeGreaterThan(0);
  });
});
