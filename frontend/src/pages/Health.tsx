import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '../services/api';
import { useDrives } from '../hooks/useDriveHealth';
import { formatBytes, timeAgo } from '../utils/format';

interface SyncDrive {
  drive_id: string;
  drive_name: string;
  status: string;
  initialized: boolean;
  open_conflicts: number;
}

interface Conflict {
  id: string;
  operation: string;
  google_file_id: string | null;
  created_at: string;
  file: { id: string; name: string; virtual_path: string } | null;
}

interface FileIssue {
  fileId: string;
  name: string;
  virtualPath: string;
  sizeBytes: number | null;
  redundancyCopies: number;
  lostChunks: number;
  degradedChunks: number;
  repairable: boolean;
}

interface HealthHistory {
  checks: Array<{ id: string; status: string; latency_ms: number | null; error_message: string | null; checked_at: string }>;
  uptimePercent: number | null;
  averageLatencyMs: number | null;
  lastError: string | null;
}

function DriveHistory({ driveId }: { driveId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['drive-health-history', driveId],
    queryFn: () => api.get(`/drives/${driveId}/health`).then((r) => r.data as HealthHistory),
  });

  if (isLoading) return <div className="skeleton h-16 w-full" />;
  if (!data || data.checks.length === 0) return <p className="text-sm text-slate-400">No checks recorded yet.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-6 text-sm">
        <span className="text-slate-600">
          Uptime <strong className="tabular-nums">{data.uptimePercent?.toFixed(0) ?? '—'}%</strong>
          <span className="text-slate-400"> over the last {data.checks.length} checks</span>
        </span>
        <span className="text-slate-600">
          Average latency <strong className="tabular-nums">{data.averageLatencyMs ?? '—'} ms</strong>
        </span>
      </div>
      {/* One cell per check, newest on the right. Status is written out in the title too. */}
      <div className="flex flex-row-reverse justify-end gap-[3px]">
        {data.checks.map((check) => (
          <span
            key={check.id}
            title={`${check.status} · ${check.latency_ms ?? '—'} ms · ${new Date(check.checked_at).toLocaleString()}${
              check.error_message ? ` · ${check.error_message}` : ''
            }`}
            className={`h-6 w-2 rounded-sm ${
              check.status === 'online' ? 'bg-emerald-500' : check.status === 'degraded' ? 'bg-amber-400' : 'bg-red-500'
            }`}
          />
        ))}
      </div>
      {data.lastError && <p className="text-xs text-red-600">Last error: {data.lastError}</p>}
    </div>
  );
}

export default function Health() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openDrive, setOpenDrive] = useState<string | null>(null);

  const drives = useDrives();
  const syncStatus = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get('/sync/status').then((r) => r.data.drives as SyncDrive[]),
  });
  const conflicts = useQuery({
    queryKey: ['sync-conflicts'],
    queryFn: () => api.get('/sync/conflicts').then((r) => r.data as { conflicts: Conflict[]; hasMore: boolean }),
  });
  const issues = useQuery({
    queryKey: ['file-issues'],
    queryFn: () => api.get('/files/issues').then((r) => r.data.issues as FileIssue[]),
  });

  const refresh = () => {
    for (const key of ['sync-status', 'sync-conflicts', 'file-issues', 'drives', 'notifications']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const run = async (id: string, action: () => Promise<unknown>, success: string) => {
    setBusy(id);
    try {
      await action();
      setNotice({ kind: 'info', text: success });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const syncNow = () =>
    run('sync', async () => {
      const res = await api.post('/sync/trigger');
      const results = (res.data.results ?? []) as Array<{ missing_chunks?: number; files_repaired?: number }>;
      const missing = results.reduce((n, r) => n + (r.missing_chunks ?? 0), 0);
      const repaired = results.reduce((n, r) => n + (r.files_repaired ?? 0), 0);
      setNotice({
        kind: 'info',
        text: missing === 0 ? 'Everything is in sync.' : `${missing} chunk(s) were missing; ${repaired} file(s) repaired.`,
      });
    }, 'Sync finished.');

  const loading = syncStatus.isLoading || conflicts.isLoading || issues.isLoading;

  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Storage health</h1>
          <p className="mt-1 text-sm text-slate-500">
            Checks your drives, finds data deleted outside EkDrive, and repairs what it can from the other copies.
          </p>
        </div>
        <button className="btn-primary" disabled={busy === 'sync'} onClick={syncNow}>
          {busy === 'sync' ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {notice && (
        <div
          className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${
            notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
          }`}
          role="status"
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="ml-4 opacity-60 hover:opacity-100" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="card p-6"><div className="skeleton h-10 w-full" /></div>
      ) : (
        <>
          <section className="card">
            <div className="card-header">
              <h2 className="text-base font-semibold text-slate-900">Files needing attention</h2>
            </div>
            <div className="card-body">
              {(issues.data ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">Every file has all the copies it should.</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {issues.data!.map((issue) => (
                    <li key={issue.fileId} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-[14rem] flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{issue.name}</p>
                        <p className="text-xs text-slate-500">
                          {issue.virtualPath} · {formatBytes(issue.sizeBytes)} ·{' '}
                          {issue.lostChunks > 0 ? (
                            <span className="text-red-600">
                              ⛔ {issue.lostChunks} chunk(s) have no copy left — this file cannot be fully downloaded
                            </span>
                          ) : (
                            <span className="text-amber-600">⚠ {issue.degradedChunks} chunk(s) are missing a copy</span>
                          )}
                        </p>
                      </div>
                      <button
                        className="btn-secondary"
                        disabled={!issue.repairable || busy === issue.fileId}
                        title={issue.repairable ? 'Rebuild the missing copies' : 'Nothing is left to rebuild from'}
                        onClick={() =>
                          run(issue.fileId, () => api.post(`/files/${issue.fileId}/repair`), `Repaired ${issue.name}.`)
                        }
                      >
                        {busy === issue.fileId ? 'Repairing…' : 'Repair'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="text-base font-semibold text-slate-900">Changes made outside EkDrive</h2>
            </div>
            <div className="card-body">
              {(conflicts.data?.conflicts ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">Nothing to review.</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {conflicts.data!.conflicts.map((conflict) => (
                    <li key={conflict.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-[14rem] flex-1">
                        <p className="text-sm text-slate-800">
                          Data for <strong>{conflict.file?.name ?? 'a deleted file'}</strong> was removed from Google Drive
                        </p>
                        <p className="text-xs text-slate-500">
                          {conflict.file?.virtual_path} · {timeAgo(conflict.created_at)}
                        </p>
                      </div>
                      <button
                        className="btn-secondary"
                        disabled={busy === conflict.id}
                        onClick={() =>
                          run(conflict.id, () => api.post(`/sync/conflicts/${conflict.id}/resolve`, { resolution: 'local' }), 'Kept the file and rebuilt what was possible.')
                        }
                      >
                        Keep my file
                      </button>
                      <button
                        className="btn-secondary"
                        disabled={busy === conflict.id}
                        onClick={() =>
                          run(conflict.id, () => api.post(`/sync/conflicts/${conflict.id}/resolve`, { resolution: 'remote' }), 'Accepted the deletion.')
                        }
                      >
                        Accept the deletion
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {conflicts.data?.hasMore && (
                <p className="pt-3 text-xs text-slate-500">
                  Showing the newest {conflicts.data.conflicts.length}. Resolve these to see the rest.
                </p>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="text-base font-semibold text-slate-900">Drives</h2>
            </div>
            <div className="card-body divide-y divide-slate-50">
              {(drives.data ?? []).map((drive) => {
                const sync = syncStatus.data?.find((s) => s.drive_id === drive.id);
                const open = openDrive === drive.id;
                return (
                  <div key={drive.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-[12rem] flex-1">
                        <p className="text-sm font-medium text-slate-800">{drive.google_email ?? drive.drive_name}</p>
                        <p className="text-xs text-slate-500">
                          {drive.status} · {formatBytes(drive.used_quota_bytes)} used
                          {drive.last_health_check && ` · checked ${timeAgo(drive.last_health_check)}`}
                          {sync && !sync.initialized && ' · watching for changes from now on'}
                        </p>
                      </div>
                      <button
                        className="btn-secondary"
                        disabled={busy === drive.id}
                        onClick={() => run(drive.id, () => api.post(`/drives/${drive.id}/health`), 'Drive checked.')}
                      >
                        Check
                      </button>
                      <button
                        className="btn-secondary"
                        aria-expanded={open}
                        onClick={() => setOpenDrive(open ? null : drive.id)}
                      >
                        {open ? 'Hide history' : 'History'}
                      </button>
                    </div>
                    {open && (
                      <div className="pt-4">
                        <DriveHistory driveId={drive.id} />
                      </div>
                    )}
                  </div>
                );
              })}
              {(drives.data ?? []).length === 0 && <p className="py-3 text-sm text-slate-400">No drives connected.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
