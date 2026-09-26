import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import api, { getErrorMessage } from '../services/api';
import { useDrives, useStorageMode, type Drive, type StorageModeName } from '../hooks/useDriveHealth';
import { formatBytes, timeAgo } from '../utils/format';

const MODES: Array<{ id: StorageModeName; label: string; description: string }> = [
  { id: 'balanced', label: 'Balanced', description: 'Spread files so every drive fills at a similar rate.' },
  { id: 'max_capacity', label: 'Maximum capacity', description: 'Use the drive with the most free space first. One copy of each file.' },
  { id: 'high_reliability', label: 'High reliability', description: 'Keep every chunk on at least two drives. Uses twice the space; needs 2+ drives.' },
];

const CALLBACK_MESSAGES: Record<string, string> = {
  drive_in_use: 'That Google account is already connected to another EkDrive user.',
  access_denied: 'Google access was not granted.',
  session_expired: 'Your session expired while connecting. Sign in and try again.',
};

function DriveRow({ drive, onError }: { drive: Drive; onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const used = drive.used_quota_bytes ?? 0;
  const total = drive.total_quota_bytes;
  const percent = total ? Math.min(100, (used / total) * 100) : 0;
  const badge = drive.status === 'online' ? 'badge-online' : drive.status === 'degraded' ? 'badge-degraded' : 'badge-offline';

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['drives'] });
    } catch (error) {
      onError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-4 flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-[12rem]">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 truncate">{drive.google_email ?? drive.drive_name}</p>
          <span className={`badge ${badge}`}>{drive.status}</span>
        </div>
        <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {formatBytes(used)} used of {total ? formatBytes(total) : 'unlimited'}
          {drive.last_health_check && ` · checked ${timeAgo(drive.last_health_check)}`}
        </p>
      </div>
      <button className="btn-secondary" disabled={busy} onClick={() => act(() => api.post(`/drives/${drive.id}/health`))}>
        Check
      </button>
      <button
        className="btn-secondary"
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Disconnect ${drive.google_email ?? drive.drive_name}?`)) {
            act(() => api.delete(`/drives/${drive.id}`));
          }
        }}
      >
        Disconnect
      </button>
    </div>
  );
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const drives = useDrives();
  const storageMode = useStorageMode();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get('error');
    return code ? CALLBACK_MESSAGES[code] ?? 'Connecting the drive failed. Please try again.' : null;
  });
  const connected = searchParams.get('connected') === '1';

  const handleConnectDrive = async () => {
    setConnecting(true);
    try {
      const response = await api.get('/auth/connect');
      window.location.href = response.data.authUrl;
    } catch (err) {
      setError(getErrorMessage(err));
      setConnecting(false);
    }
  };

  const setMode = async (mode: StorageModeName) => {
    try {
      await api.put('/storage-mode', { mode });
      await queryClient.invalidateQueries({ queryKey: ['storage-mode'] });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const onlineDrives = drives.data?.filter((d) => d.status !== 'offline').length ?? 0;

  const rebalance = useQuery({
    queryKey: ['rebalance'],
    queryFn: () => api.get('/storage-mode/rebalance').then((r) => r.data as { running: boolean }),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });

  const startRebalance = async () => {
    try {
      await api.post('/storage-mode/rebalance');
    } catch (err) {
      setError(getErrorMessage(err));
    }
    queryClient.invalidateQueries({ queryKey: ['rebalance'] });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your connected drives and storage preferences.</p>
      </div>

      {(error || connected) && (
        <div className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          <span>{error ?? 'Drive connected.'}</span>
          <button
            aria-label="Dismiss"
            className="ml-4 opacity-60 hover:opacity-100"
            onClick={() => {
              setError(null);
              setSearchParams({}, { replace: true });
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Connected Drives</h2>
          <button onClick={handleConnectDrive} disabled={connecting} className="btn-primary">
            {connecting ? 'Connecting…' : 'Connect Drive'}
          </button>
        </div>
        <div className="card-body py-0 divide-y divide-slate-50">
          {drives.isLoading ? (
            <div className="py-6"><div className="skeleton h-10 w-full" /></div>
          ) : drives.data?.length ? (
            drives.data.map((drive) => <DriveRow key={drive.id} drive={drive} onError={setError} />)
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">No drives connected yet.</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="text-base font-semibold text-gray-900">Storage Mode</h2>
          <p className="text-xs text-gray-400 mt-1">Applies to new uploads. Rebalance to apply it to files you already have.</p>
        </div>
        <div className="card-body space-y-2">
          {MODES.map((mode) => {
            const active = storageMode.data?.mode === mode.id;
            const unavailable = mode.id === 'high_reliability' && onlineDrives < 2;
            return (
              <button
                key={mode.id}
                disabled={unavailable || active}
                onClick={() => setMode(mode.id)}
                className={`w-full text-left flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${
                  active ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100 hover:border-slate-300'
                } disabled:cursor-default ${unavailable ? 'opacity-50' : ''}`}
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{mode.label}</p>
                  <p className="text-sm text-gray-400">{mode.description}</p>
                </div>
                {active && <span className="badge badge-online">Active</span>}
              </button>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <p className="text-sm text-gray-500">
              Rebalance copies or removes chunk copies to match the mode, and in Balanced mode moves chunks off fuller drives.
              You'll get a notification when it finishes.
            </p>
            <button className="btn-secondary" disabled={rebalance.data?.running} onClick={startRebalance}>
              {rebalance.data?.running ? 'Rebalancing…' : 'Rebalance now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
