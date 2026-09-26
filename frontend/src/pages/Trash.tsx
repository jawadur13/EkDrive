import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '../services/api';
import { formatBytes, timeAgo } from '../utils/format';

interface TrashItem {
  id: string;
  name: string;
  is_folder: boolean;
  size_bytes: number | null;
  virtual_path: string;
  trashed_at: string;
}

export default function Trash() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: () => api.get('/trash').then((r) => r.data as { items: TrashItem[]; retentionDays: number }),
  });

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
    queryClient.invalidateQueries({ queryKey: ['trash'] });
    queryClient.invalidateQueries({ queryKey: ['files'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Trash</h1>
          <p className="mt-1 text-sm text-slate-500">
            Items are deleted for good after {data?.retentionDays ?? 30} days. They still use Google Drive space until then.
          </p>
        </div>
        {items.length > 0 && (
          <button
            className="btn-danger"
            onClick={() => window.confirm('Permanently delete everything in the trash?') && run(() => api.delete('/trash'))}
          >
            Empty trash
          </button>
        )}
      </div>

      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {isLoading ? (
        <div className="card p-6"><div className="skeleton h-10 w-full" /></div>
      ) : items.length === 0 ? (
        <div className="card py-16 text-center text-sm text-slate-400">The trash is empty.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Original location</th>
                <th className="px-6 py-4">Size</th>
                <th className="px-6 py-4">Deleted</th>
                <th className="px-6 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-3 text-sm font-semibold text-slate-700">
                    {item.is_folder ? '📁' : '📄'} <span className="ml-2">{item.name}</span>
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-400 truncate max-w-xs">
                    {item.virtual_path.slice(0, item.virtual_path.lastIndexOf('/')) || '/'}
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-500">{item.is_folder ? '—' : formatBytes(item.size_bytes)}</td>
                  <td className="px-6 py-3 text-sm text-slate-400">{timeAgo(item.trashed_at)}</td>
                  <td className="px-6 py-3 text-right text-xs space-x-3">
                    <button className="text-slate-500 hover:text-blue-600" onClick={() => run(() => api.post(`/trash/${item.id}/restore`))}>
                      Restore
                    </button>
                    <button
                      className="text-slate-500 hover:text-red-600"
                      onClick={() => window.confirm(`Permanently delete "${item.name}"?`) && run(() => api.delete(`/trash/${item.id}`))}
                    >
                      Delete forever
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
