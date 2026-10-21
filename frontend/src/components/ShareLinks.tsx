import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '../services/api';
import { getShareUrl } from '../services/download';
import { formatBytes, timeAgo } from '../utils/format';

interface ShareLink {
  id: string;
  token: string;
  expires_at: string | null;
  max_downloads: number | null;
  download_count: number;
  permissions: string;
  created_at: string;
  file: { id: string; name: string; mime_type: string | null; size_bytes: number | null };
}

/** Lists the links this account has handed out, so they can be checked and taken back. */
export function ShareLinks({ onError }: { onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['shares'],
    queryFn: () => api.get('/shares').then((r) => r.data as { shares: ShareLink[]; hasMore: boolean }),
  });

  const revoke = async (share: ShareLink) => {
    if (!window.confirm(`Revoke the link to "${share.file.name}"? Anyone holding it loses access.`)) return;
    try {
      await api.delete(`/shares/${share.id}`);
      await queryClient.invalidateQueries({ queryKey: ['shares'] });
    } catch (error) {
      onError(getErrorMessage(error));
    }
  };

  const copy = async (share: ShareLink) => {
    const url = getShareUrl(share.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(share.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt('Share link', url);
    }
  };

  const expiry = (share: ShareLink) => {
    if (share.expires_at && new Date(share.expires_at) < new Date()) return 'expired';
    if (share.expires_at) return `expires ${new Date(share.expires_at).toLocaleDateString()}`;
    return 'no expiry';
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-base font-semibold text-gray-900">Share links</h2>
        <p className="mt-1 text-xs text-gray-400">Anyone with one of these links can open that file without signing in.</p>
      </div>
      <div className="card-body">
        {isLoading ? (
          <div className="skeleton h-10 w-full" />
        ) : (data?.shares ?? []).length === 0 ? (
          <p className="text-sm text-gray-400">You have not shared anything.</p>
        ) : (
          <ul className="divide-y divide-slate-50">
            {data!.shares.map((share) => (
              <li key={share.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{share.file.name}</p>
                  <p className="text-xs text-slate-500">
                    {formatBytes(share.file.size_bytes)} · {share.download_count}
                    {share.max_downloads ? ` of ${share.max_downloads}` : ''} download(s) · {expiry(share)} · created{' '}
                    {timeAgo(share.created_at)}
                  </p>
                </div>
                <button className="btn-secondary" onClick={() => copy(share)}>
                  {copied === share.id ? 'Copied' : 'Copy link'}
                </button>
                <button className="btn-secondary" onClick={() => revoke(share)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        {data?.hasMore && <p className="pt-3 text-xs text-slate-500">Showing the newest {data.shares.length} links.</p>}
      </div>
    </div>
  );
}
