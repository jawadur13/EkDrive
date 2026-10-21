import { useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { getErrorMessage } from '../services/api';
import { uploadFile } from '../services/upload';
import { getDownloadUrl, getShareUrl } from '../services/download';
import { canPreview, PreviewModal } from '../components/PreviewModal';
import { MoveDialog } from '../components/MoveDialog';
import { RowMenu } from '../components/RowMenu';
import { formatBytes, timeAgo } from '../utils/format';

interface FileItem {
  id: string;
  name: string;
  is_folder: boolean;
  parent_id: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  updated_at: string;
  redundancy_copies: number;
}

interface UploadTask {
  id: string;
  name: string;
  loaded: number;
  total: number;
  error?: string;
  controller: AbortController;
}

const THUMBNAILABLE = /^image\/(png|jpe?g|gif|webp|avif|bmp|tiff)$/;

// Shows the picture itself where there is one; the icon stays as the fallback, including
// when the thumbnail cannot be made (too large, or the bytes are not really an image).
function FileIcon({ file }: { file: FileItem }) {
  const [failed, setFailed] = useState(false);
  const showImage = !failed && THUMBNAILABLE.test(file.mime_type ?? '');

  return (
    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50 text-xl">
      {showImage ? (
        <img
          src={`/api/v1/files/${file.id}/thumbnail`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        getFileIcon(file.mime_type, file.is_folder)
      )}
    </span>
  );
}

function getFileIcon(mimeType: string | null, isFolder: boolean) {
  if (isFolder) return '📁';
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.startsWith('text/')) return '📝';
  return '📄';
}

export default function FileList() {
  const { folderId } = useParams();
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get('q');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [previewing, setPreviewing] = useState<FileItem | null>(null);
  const [moving, setMoving] = useState<FileItem | null>(null);

  const listQuery = useInfiniteQuery({
    queryKey: ['files', folderId ?? 'root'],
    enabled: !searchQuery,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api
        .get('/files', { params: { parentFolderId: folderId, cursor: pageParam ?? undefined } })
        .then((r) => r.data as { files: FileItem[]; pagination: { nextCursor: string | null } }),
    getNextPageParam: (last) => last.pagination.nextCursor,
  });

  const searchResults = useQuery({
    queryKey: ['search', searchQuery],
    enabled: Boolean(searchQuery),
    queryFn: () => api.get('/files/search', { params: { q: searchQuery } }).then((r) => r.data.results as FileItem[]),
  });

  const breadcrumbs = useQuery({
    queryKey: ['breadcrumbs', folderId],
    enabled: Boolean(folderId) && !searchQuery,
    queryFn: () =>
      api.get(`/files/${folderId}/breadcrumbs`).then((r) => r.data.breadcrumbs as Array<{ id: string; name: string }>),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['files'] });
    queryClient.invalidateQueries({ queryKey: ['search'] });
    queryClient.invalidateQueries({ queryKey: ['drives'] });
    queryClient.invalidateQueries({ queryKey: ['trash'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  };

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) setNotice({ kind: 'info', text: success });
      refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error) });
    }
  };

  // A folder upload arrives as a flat list whose webkitRelativePath holds the structure, so
  // the folders are created first and each file is sent into the one it belongs to.
  const ensureFolders = async (paths: string[]) => {
    const created = new Map<string, string | null>([['', folderId ?? null]]);
    for (const path of [...new Set(paths)].sort()) {
      const parts = path.split('/').filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const key = parts.slice(0, i + 1).join('/');
        if (created.has(key)) continue;
        const parent = created.get(parts.slice(0, i).join('/')) ?? null;
        const res = await api.post('/files', { name: parts[i], parentFolderId: parent });
        created.set(key, res.data.id as string);
      }
    }
    return created;
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const list = Array.from(fileList);
    const relativeDirs = list.map((file) => (file.webkitRelativePath || '').split('/').slice(0, -1).join('/'));

    let folders = new Map<string, string | null>([['', folderId ?? null]]);
    if (relativeDirs.some(Boolean)) {
      try {
        folders = await ensureFolders(relativeDirs.filter(Boolean));
      } catch (error) {
        setNotice({ kind: 'error', text: getErrorMessage(error) });
        return;
      }
      refresh();
    }

    for (const [position, file] of list.entries()) {
      const task: UploadTask = { id: crypto.randomUUID(), name: file.name, loaded: 0, total: file.size, controller: new AbortController() };
      setUploads((prev) => [...prev, task]);
      const update = (patch: Partial<UploadTask>) =>
        setUploads((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));

      try {
        const destination = folders.get(relativeDirs[position]) ?? folderId ?? null;
        await uploadFile(file, destination, (loaded) => update({ loaded }), task.controller.signal);
        setUploads((prev) => prev.filter((t) => t.id !== task.id));
        refresh();
      } catch (error) {
        update({ error: task.controller.signal.aborted ? 'Cancelled' : getErrorMessage(error) });
      }
    }
    if (fileInput.current) fileInput.current.value = '';
    if (folderInput.current) folderInput.current.value = '';
  };

  const createFolder = () => {
    const name = window.prompt('Folder name');
    if (name?.trim()) run(() => api.post('/files', { name: name.trim(), parentFolderId: folderId ?? null }));
  };

  const rename = (file: FileItem) => {
    const name = window.prompt('New name', file.name);
    if (name?.trim() && name.trim() !== file.name) run(() => api.patch(`/files/${file.id}`, { name: name.trim() }));
  };

  const remove = (file: FileItem) => {
    const what = file.is_folder ? `folder "${file.name}" and everything in it` : `"${file.name}"`;
    if (window.confirm(`Move ${what} to the trash?`)) {
      run(() => api.delete(`/files/${file.id}`), `Moved ${file.name} to the trash`);
    }
  };

  const move = (file: FileItem, destinationId: string | null) => {
    setMoving(null);
    run(() => api.patch(`/files/${file.id}`, { parentFolderId: destinationId }), `Moved ${file.name}.`);
  };

  const share = (file: FileItem) =>
    run(async () => {
      const res = await api.post('/shares', { fileId: file.id, permissions: 'download' });
      const url = getShareUrl(res.data.token);
      await navigator.clipboard.writeText(url).catch(() => window.prompt('Share link', url));
    }, 'Share link copied to clipboard');

  const open = (file: FileItem) => {
    if (file.is_folder) navigate(`/files/${file.id}`);
    else if (canPreview(file.mime_type)) setPreviewing(file);
    else window.location.assign(getDownloadUrl(file.id));
  };

  const isLoading = searchQuery ? searchResults.isLoading : listQuery.isLoading;
  const isError = searchQuery ? searchResults.isError : listQuery.isError;
  const files: FileItem[] = searchQuery ? searchResults.data ?? [] : listQuery.data?.pages.flatMap((p) => p.files) ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      {previewing && <PreviewModal file={previewing} onClose={() => setPreviewing(null)} />}
      {moving && (
        <MoveDialog
          item={moving}
          currentParentId={moving.parent_id}
          onCancel={() => setMoving(null)}
          onMove={(destinationId) => move(moving, destinationId)}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-1 text-xl font-bold text-slate-900 tracking-tight min-w-0">
          {searchQuery ? (
            <span className="truncate">Search: {searchQuery}</span>
          ) : (
            <>
              <Link to="/files" className={folderId ? 'text-slate-400 hover:text-blue-600' : ''}>Files</Link>
              {breadcrumbs.data?.map((crumb, i) => (
                <span key={crumb.id} className="flex items-center gap-1 min-w-0">
                  <span className="text-slate-300">/</span>
                  {i === breadcrumbs.data.length - 1 ? (
                    <span className="truncate">{crumb.name}</span>
                  ) : (
                    <Link to={`/files/${crumb.id}`} className="text-slate-400 hover:text-blue-600 truncate">{crumb.name}</Link>
                  )}
                </span>
              ))}
            </>
          )}
        </nav>
        {!searchQuery && (
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={createFolder}>New folder</button>
            <button className="btn-secondary" onClick={() => folderInput.current?.click()}>Upload folder</button>
            <button className="btn-primary" onClick={() => fileInput.current?.click()}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Upload
            </button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
            {/* webkitdirectory is how every current browser exposes picking a folder. */}
            <input
              ref={folderInput}
              type="file"
              hidden
              multiple
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        )}
      </div>

      {notice && (
        <div className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="ml-4 opacity-60 hover:opacity-100" aria-label="Dismiss">✕</button>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="card divide-y divide-slate-50" role="status" aria-live="polite">
          {uploads.map((task) => (
            <div key={task.id} className="px-6 py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{task.name}</p>
                {task.error ? (
                  <p className="text-xs text-red-600">{task.error}</p>
                ) : (
                  <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 transition-all" style={{ width: `${task.total ? (task.loaded / task.total) * 100 : 100}%` }} />
                  </div>
                )}
              </div>
              <span className="text-xs text-slate-400 w-28 text-right">{formatBytes(task.loaded)} / {formatBytes(task.total)}</span>
              <button
                className="text-xs text-slate-400 hover:text-red-600"
                onClick={() => (task.error ? setUploads((prev) => prev.filter((t) => t.id !== task.id)) : task.controller.abort())}
              >
                {task.error ? 'Dismiss' : 'Cancel'}
              </button>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="card px-6 py-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="skeleton w-8 h-8 rounded" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-48" />
                <div className="skeleton h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="card py-16 text-center">
          <h3 className="text-sm font-medium text-gray-900 mb-1">Failed to load files</h3>
          <p className="text-sm text-gray-500">Something went wrong. Please try again.</p>
        </div>
      ) : files.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 px-6 text-center">
          <h3 className="text-sm font-medium text-gray-900 mb-1">{searchQuery ? 'No results found' : 'This folder is empty'}</h3>
          <p className="text-sm text-gray-400">
            {searchQuery ? `No files match "${searchQuery}"` : 'Upload a file or create a folder to get started.'}
          </p>
        </div>
      ) : (
        <div className="card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                <th className="hidden sm:table-cell text-left px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Size</th>
                <th className="hidden md:table-cell text-left px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Modified</th>
                <th className="px-2 py-4 sm:px-4"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {files.map((file) => (
                <tr key={file.id} className="hover:bg-blue-50/40 transition-colors duration-200 group">
                  <td className="min-w-0 px-4 py-3 sm:px-6">
                    <button onClick={() => open(file)} className="flex w-full items-center gap-3 text-left">
                      <FileIcon file={file} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-700 group-hover:text-blue-600">
                          {file.name}
                          {file.redundancy_copies > 1 && (
                            <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                              {file.redundancy_copies}× copies
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-slate-400 sm:hidden">
                          {file.is_folder ? 'Folder' : formatBytes(file.size_bytes)} · {timeAgo(file.updated_at)}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="hidden sm:table-cell px-6 py-3 text-sm text-slate-500 font-medium">
                    {file.is_folder ? '—' : formatBytes(file.size_bytes)}
                  </td>
                  <td className="hidden md:table-cell px-6 py-3 text-sm text-slate-400">{timeAgo(file.updated_at)}</td>
                  <td className="px-2 py-3 text-right sm:px-4">
                    <RowMenu
                      label={file.name}
                      actions={[
                        ...(file.is_folder
                          ? [{ label: 'Download as zip', href: `/api/v1/files/${file.id}/archive` }]
                          : [
                              { label: 'Download', href: getDownloadUrl(file.id) },
                              { label: 'Copy share link', onSelect: () => share(file) },
                            ]),
                        { label: 'Move to…', onSelect: () => setMoving(file) },
                        { label: 'Rename', onSelect: () => rename(file) },
                        { label: 'Delete', onSelect: () => remove(file), danger: true },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!searchQuery && listQuery.hasNextPage && (
            <div className="p-4 text-center border-t border-slate-50">
              <button className="btn-secondary" disabled={listQuery.isFetchingNextPage} onClick={() => listQuery.fetchNextPage()}>
                {listQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
