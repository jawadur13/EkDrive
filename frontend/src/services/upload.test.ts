import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock('./api', () => ({ default: { post, get, delete: del } }));

const { uploadFile } = await import('./upload');

function makeFile(size: number, name = 'f.bin') {
  const file = new File([new Uint8Array(size)], name, { type: 'application/octet-stream' });
  // jsdom's File has no lastModified control and no arrayBuffer on slices in older versions.
  Object.defineProperty(file, 'lastModified', { value: 1_700_000_000_000 });
  return file;
}

const CHUNK = 100;
const initResponse = (fileId: string, chunkCount: number) => ({
  data: { fileId, chunkSize: CHUNK, chunkCount, placement: [] },
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  post.mockImplementation(async (url: string) => {
    if (url === '/upload/init') return initResponse('file-1', 3);
    if (url.endsWith('/complete')) return { data: { id: 'file-1', status: 'ready' } };
    return { data: { status: 'uploaded' } };
  });
});

describe('uploadFile', () => {
  it('sends every chunk with a checksum header and reports progress to the end', async () => {
    const progress: number[] = [];
    await uploadFile(makeFile(250), null, (loaded) => progress.push(loaded));

    const chunkCalls = post.mock.calls.filter(([url]) => url.includes('/chunk/'));
    expect(chunkCalls.map(([url]) => url)).toEqual([
      '/upload/file-1/chunk/0',
      '/upload/file-1/chunk/1',
      '/upload/file-1/chunk/2',
    ]);
    for (const [, , config] of chunkCalls) {
      expect(config.headers['x-chunk-checksum']).toMatch(/^[0-9a-f]+$/);
    }
    expect(progress.at(-1)).toBe(250);

    // The whole-file hash goes with the completion call.
    const [, completeBody] = post.mock.calls.find(([url]) => url.endsWith('/complete'))!;
    expect(completeBody.checksum).toMatch(/^[0-9a-f]+$/);
  });

  it('resumes an interrupted upload and only sends what is missing', async () => {
    const file = makeFile(250);
    // A previous attempt left its id behind.
    post.mockImplementationOnce(async () => initResponse('file-1', 3));
    await expect(
      uploadFile(file, null, () => {}, AbortSignal.abort())
    ).rejects.toBeTruthy();

    get.mockResolvedValue({
      data: { status: 'uploading', chunkSize: CHUNK, chunkCount: 3, uploadedChunks: [0], missingChunks: [1, 2] },
    });
    post.mockClear();

    await uploadFile(file, null, () => {});

    expect(get).toHaveBeenCalledWith('/upload/file-1/status');
    expect(post.mock.calls.filter(([url]) => url === '/upload/init')).toHaveLength(0);
    expect(post.mock.calls.filter(([url]) => url.includes('/chunk/')).map(([url]) => url)).toEqual([
      '/upload/file-1/chunk/1',
      '/upload/file-1/chunk/2',
    ]);
  });

  it('starts over when the saved upload is no longer resumable', async () => {
    const file = makeFile(100, 'gone.bin');
    await uploadFile(file, null, () => {});
    post.mockClear();
    get.mockRejectedValue(new Error('404'));

    await uploadFile(file, null, () => {});
    expect(post.mock.calls.some(([url]) => url === '/upload/init')).toBe(true);
  });

  it('abandons the server-side upload when it fails for a reason other than cancelling', async () => {
    post.mockImplementation(async (url: string) => {
      if (url === '/upload/init') return initResponse('file-2', 1);
      if (url.includes('/chunk/')) throw Object.assign(new Error('bad request'), { response: { status: 400 }, isAxiosError: true });
      return { data: {} };
    });

    await expect(uploadFile(makeFile(50), null, () => {})).rejects.toThrow();
    expect(del).toHaveBeenCalledWith('/upload/file-2');
  });

  it('keeps the stored chunks when the user cancels, so the next try resumes', async () => {
    const controller = new AbortController();
    post.mockImplementation(async (url: string) => {
      if (url === '/upload/init') return initResponse('file-3', 2);
      controller.abort();
      throw Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED', isAxiosError: true });
    });

    await expect(uploadFile(makeFile(150), null, () => {}, controller.signal)).rejects.toBeTruthy();
    expect(del).not.toHaveBeenCalled();
  });
});
