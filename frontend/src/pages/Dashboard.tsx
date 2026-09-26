import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { formatBytes } from '../utils/format';

interface Analytics {
  totals: {
    files: number;
    folders: number;
    logicalBytes: number;
    storedBytes: number;
    trashFiles: number;
    trashBytes: number;
    poolTotalBytes: number | null;
    poolAvailableBytes: number;
  };
  drives: Array<{ id: string; name: string; status: string; totalBytes: number | null; usedBytes: number; ekdriveBytes: number; chunks: number }>;
  byType: Array<{ type: string; files: number; bytes: number }>;
  timeline: Array<{ date: string; files: number; bytes: number }>;
}

// Chart roles (validated pair: categorical slots 1–2 of the reference palette).
const SERIES_EKDRIVE = '#2a78d6';
const SERIES_OTHER = '#eb6834';
const TRACK = '#eef0f3';

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Tooltip({ lines }: { lines: string[] }) {
  return (
    <div className="pointer-events-none absolute z-10 -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg">
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

// One horizontal bar per drive: EkDrive's chunks, other Google usage, then free space as track.
function DriveUsage({ drives }: { drives: Analytics['drives'] }) {
  const [hover, setHover] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="card-header flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Space per drive</h2>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_EKDRIVE }} />EkDrive data</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_OTHER }} />Other Google usage</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-slate-200" style={{ background: TRACK }} />Free</span>
        </div>
      </div>
      <div className="card-body space-y-5">
        {drives.length === 0 && <p className="text-sm text-slate-400">No drives connected.</p>}
        {drives.map((drive) => {
          // Google's usage figure is cached and can lag behind chunks EkDrive just wrote.
          const used = Math.max(drive.usedBytes, drive.ekdriveBytes);
          const total = drive.totalBytes ?? Math.max(used, 1);
          const other = used - drive.ekdriveBytes;
          const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`;
          const segments = [
            { key: 'ekdrive', value: drive.ekdriveBytes, color: SERIES_EKDRIVE, label: 'EkDrive data' },
            { key: 'other', value: other, color: SERIES_OTHER, label: 'Other Google usage' },
          ];
          return (
            <div key={drive.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
                <span className="truncate font-medium text-slate-700">
                  {drive.name}
                  {drive.status !== 'online' && <span className="ml-2 text-xs text-slate-500">({drive.status})</span>}
                </span>
                <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                  {formatBytes(used)} of {drive.totalBytes ? formatBytes(drive.totalBytes) : 'unlimited'}
                </span>
              </div>
              <div className="flex h-3 w-full gap-[2px] overflow-visible rounded" style={{ background: TRACK }}>
                {segments
                  .filter((s) => s.value > 0)
                  .map((s) => {
                    const id = `${drive.id}-${s.key}`;
                    return (
                      <div
                        key={s.key}
                        className="relative h-full first:rounded-l last:rounded-r"
                        style={{ width: pct(s.value), background: s.color, minWidth: 3 }}
                        onMouseEnter={() => setHover(id)}
                        onMouseLeave={() => setHover(null)}
                      >
                        {hover === id && <Tooltip lines={[s.label, formatBytes(s.value)]} />}
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ByType({ rows }: { rows: Analytics['byType'] }) {
  const max = Math.max(...rows.map((r) => r.bytes), 1);
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-base font-semibold text-slate-900">Storage by file type</h2>
      </div>
      <div className="card-body space-y-3">
        {rows.length === 0 && <p className="text-sm text-slate-400">No files yet.</p>}
        {rows.map((row) => (
          <div key={row.type} className="grid grid-cols-[6rem_1fr_5.5rem] items-center gap-3 text-sm" title={`${row.files} file(s)`}>
            <span className="text-slate-600">{row.type}</span>
            <div className="h-3 rounded-r" style={{ width: `${Math.max(1, (row.bytes / max) * 100)}%`, background: SERIES_EKDRIVE }} />
            <span className="text-right text-xs text-slate-500 tabular-nums">{formatBytes(row.bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UploadTimeline({ days }: { days: Analytics['timeline'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.bytes), 1);
  const label = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className="card">
      <div className="card-header flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-slate-900">Uploaded per day</h2>
        <span className="text-xs text-slate-400">Last {days.length} days</span>
      </div>
      <div className="card-body">
        <div className="flex h-40 items-end gap-[2px] border-b border-slate-200">
          {days.map((day, i) => (
            <div
              key={day.date}
              className="relative flex h-full flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="w-full rounded-t"
                style={{
                  height: day.bytes > 0 ? `${Math.max(2, (day.bytes / max) * 100)}%` : 0,
                  background: SERIES_EKDRIVE,
                  opacity: hover === null || hover === i ? 1 : 0.55,
                }}
              />
              {hover === i && <Tooltip lines={[label(day.date), `${day.files} file(s)`, formatBytes(day.bytes)]} />}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-400">
          <span>{days[0] && label(days[0].date)}</span>
          <span>{days.at(-1) && label(days.at(-1)!.date)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics'],
    queryFn: () => api.get('/analytics').then((r) => r.data as Analytics),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
      </div>
    );
  }
  if (isError || !data) {
    return <div className="card py-16 text-center text-sm text-slate-500">Could not load analytics.</div>;
  }

  const { totals } = data;
  const overhead = totals.logicalBytes > 0 ? totals.storedBytes / totals.logicalBytes : 1;

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Files" value={totals.files.toLocaleString()} hint={`${totals.folders.toLocaleString()} folder(s)`} />
        <StatTile label="Your data" value={formatBytes(totals.logicalBytes)} hint={`${formatBytes(totals.storedBytes)} with copies (${overhead.toFixed(1)}×)`} />
        <StatTile
          label="Free across drives"
          value={formatBytes(totals.poolAvailableBytes)}
          hint={totals.poolTotalBytes ? `of ${formatBytes(totals.poolTotalBytes)}` : 'at least one drive is unlimited'}
        />
        <StatTile label="In trash" value={formatBytes(totals.trashBytes)} hint={`${totals.trashFiles} file(s)`} />
      </div>

      <DriveUsage drives={data.drives} />

      <div className="grid gap-6 lg:grid-cols-2">
        <UploadTimeline days={data.timeline} />
        <ByType rows={data.byType} />
      </div>

      <details className="card">
        <summary className="card-header cursor-pointer text-sm font-semibold text-slate-700">Drive details as a table</summary>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">Drive</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">EkDrive data</th>
                <th className="px-6 py-3 text-right">Total used</th>
                <th className="px-6 py-3 text-right">Capacity</th>
                <th className="px-6 py-3 text-right">Chunks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 tabular-nums">
              {data.drives.map((d) => (
                <tr key={d.id}>
                  <td className="px-6 py-2 text-slate-700">{d.name}</td>
                  <td className="px-6 py-2 text-slate-500">{d.status}</td>
                  <td className="px-6 py-2 text-right">{formatBytes(d.ekdriveBytes)}</td>
                  <td className="px-6 py-2 text-right">{formatBytes(d.usedBytes)}</td>
                  <td className="px-6 py-2 text-right">{d.totalBytes ? formatBytes(d.totalBytes) : 'Unlimited'}</td>
                  <td className="px-6 py-2 text-right">{d.chunks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {data.drives.length < 2 && (
        <p className="text-sm text-slate-500">
          Connect another Google account in <Link to="/settings" className="text-blue-600 hover:underline">Settings</Link> to pool its space.
        </p>
      )}
    </div>
  );
}
