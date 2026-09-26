import { useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { getErrorMessage } from '../services/api';
import { uploadFile } from '../services/upload';
import { getDownloadUrl, getShareUrl } from '../services/download';
import { canPreview, PreviewModal } from '../components/PreviewModal';
import { formatBytes, timeAgo } from '../utils/format';

interface FileItem {
  id: string;
  name: string;
  is_folder: boolean;
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
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [previewing, setPreviewing] = useState<FileItem | null>(null);

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

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      const task: UploadTask = { id: crypto.randomUUID(), name: file.name, loaded: 0, total: file.size, controller: new AbortController() };
      setUploads((prev) => [...prev, task]);
      const update = (patch: Partial<UploadTask>) =>
        setUploads((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));

      try {
        await uploadFile(file, folderId ?? null, (loaded) => update({ loaded }), task.controller.signal);
        setUploads((prev) => prev.filter((t) => t.id !== task.id));
        refresh();
      } catch (error) {
        update({ error: task.controller.signal.aborted ? 'Cancelled' : getErrorMessage(error) });
      }
    }
    if (fileInput.current) fileInput.current.value = '';
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
            <button className="btn-primary" onClick={() => fileInput.current?.click()}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Upload
            </button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
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
        <div className="card divide-y divide-slate-50">
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
        <div className="card overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Size</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Modified</th>
                <th className="px-6 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {files.map((file) => (
                <tr key={file.id} className="hover:bg-blue-50/40 transition-colors duration-200 group">
                  <td className="px-6 py-3">
                    <button onClick={() => open(file)} className="flex items-center gap-4 text-left max-w-sm">
                      <span className="text-xl flex-shrink-0 w-9 h-9 flex items-center justify-center bg-slate-50 rounded-xl">
                        {getFileIcon(file.mime_type, file.is_folder)}
                      </span>
                      <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-600 truncate">{file.name}</span>
                      {file.redundancy_copies > 1 && (
                        <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5">{file.redundancy_copies}× copies</span>
                      )}
                    </button>
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-500 font-medium">{file.is_folder ? '—' : formatBytes(file.size_bytes)}</td>
                  <td className="px-6 py-3 text-sm text-slate-400">{timeAgo(file.updated_at)}</td>
                  <td className="px-6 py-3 text-right text-xs space-x-3">
                    {!file.is_folder && (
                      <>
                        <a href={getDownloadUrl(file.id)} className="text-slate-500 hover:text-blue-600">Download</a>
                        <button onClick={() => share(file)} className="text-slate-500 hover:text-blue-600">Share</button>
                      </>
                    )}
                    <button onClick={() => rename(file)} className="text-slate-500 hover:text-blue-600">Rename</button>
                    <button onClick={() => remove(file)} className="text-slate-500 hover:text-red-600">Delete</button>
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
