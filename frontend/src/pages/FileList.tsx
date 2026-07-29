import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../services/api';

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(dateString: string) {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

function getFileIcon(mimeType?: string, isFolder?: boolean) {
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

  const queryKey = ['files', folderId || 'root', searchQuery || ''];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => {
      const params: Record<string, string> = {};
      if (folderId) params.parentFolderId = folderId;
      if (searchQuery) {
        return api.get('/files/search', { params: { q: searchQuery } }).then((r) => r.data);
      }
      return api.get('/files', { params }).then((r) => r.data);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="skeleton h-6 w-20" />
          <div className="skeleton h-9 w-20 rounded-lg" />
        </div>
        <div className="card">
          <div className="px-6 py-4 space-y-3">
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
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <h3 className="text-sm font-medium text-gray-900 mb-1">Failed to load files</h3>
          <p className="text-sm text-gray-500">Something went wrong. Please try again.</p>
        </div>
      </div>
    );
  }

  const files = data?.files ?? data?.results ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          {searchQuery ? `Search: ${searchQuery}` : 'Files'}
        </h2>
        <button className="btn-primary" disabled>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Upload File
        </button>
      </div>

      {files.length === 0 ? (
        <div className="card">
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-gray-900 mb-1">
              {searchQuery ? 'No results found' : 'No files yet'}
            </h3>
            <p className="text-sm text-gray-400">
              {searchQuery ? `No files match "${searchQuery}"` : 'Upload your first file to get started.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Size</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Modified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {files.map((file: any) => (
                <tr key={file.id} className="hover:bg-blue-50/40 transition-colors duration-200 cursor-pointer group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <span className="text-xl flex-shrink-0 w-9 h-9 flex items-center justify-center bg-slate-50 rounded-xl group-hover:bg-white group-hover:shadow-sm transition-all">
                        {getFileIcon(file.mime_type, file.is_folder)}
                      </span>
                      <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-600 transition-colors truncate max-w-sm">{file.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500 font-medium">{file.is_folder ? '—' : formatBytes(file.size_bytes)}</td>
                  <td className="px-6 py-4 text-sm text-slate-400">{timeAgo(file.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
