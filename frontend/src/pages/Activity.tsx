import { useInfiniteQuery } from '@tanstack/react-query';
import api from '../services/api';
import { timeAgo } from '../utils/format';

interface ActivityItem {
  id: string;
  action: string;
  file_name: string | null;
  details: Record<string, any> | null;
  created_at: string;
}

function describe(item: ActivityItem) {
  const name = item.file_name ? `“${item.file_name}”` : '';
  const d = item.details ?? {};
  switch (item.action) {
    case 'file.uploaded': return `Uploaded ${name}${d.copies > 1 ? ` (${d.copies} copies)` : ''}`;
    case 'folder.created': return `Created folder ${name}`;
    case 'file.renamed': return `Renamed “${d.from}” to ${name}`;
    case 'file.moved': return `Moved ${name} to ${String(d.to ?? '').replace(/\/[^/]*$/, '') || '/'}`;
    case 'file.trashed': return `Moved ${name} to the trash`;
    case 'file.restored': return `Restored ${name} from the trash`;
    case 'file.deleted': return d.emptiedTrash ? `Emptied the trash (${d.emptiedTrash} item(s))` : `Permanently deleted ${name}`;
    case 'file.repaired': return `Repaired ${name} (${d.copiesAdded ?? 0} copies rebuilt)`;
    case 'share.created': return `Created a share link for ${name}`;
    case 'share.revoked': return `Revoked a share link for ${name}`;
    case 'share.accessed': return `Someone opened your shared file ${name}`;
    case 'drive.connected': return `Connected ${d.drive}`;
    case 'drive.disconnected': return `Disconnected ${d.drive}`;
    case 'storage_mode.changed': return `Changed storage mode from ${d.from} to ${d.to}`;
    case 'storage.rebalanced': return `Rebalanced storage: ${d.chunksMoved ?? 0} chunk(s) moved, ${d.copiesAdded ?? 0} copies added, ${d.copiesRemoved ?? 0} removed`;
    default: return `${item.action} ${name}`;
  }
}

export default function Activity() {
  const query = useInfiniteQuery({
    queryKey: ['activity'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get('/activity', { params: { cursor: pageParam ?? undefined } }).then((r) => r.data as { items: ActivityItem[]; nextCursor: string | null }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Activity</h1>
      {query.isLoading ? (
        <div className="card p-6"><div className="skeleton h-10 w-full" /></div>
      ) : items.length === 0 ? (
        <div className="card py-16 text-center text-sm text-slate-400">Nothing yet.</div>
      ) : (
        <div className="card divide-y divide-slate-50">
          {items.map((item) => (
            <div key={item.id} className="flex items-baseline justify-between gap-4 px-6 py-3">
              <p className="text-sm text-slate-700">{describe(item)}</p>
              <time className="shrink-0 text-xs text-slate-400" dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>
                {timeAgo(item.created_at)}
              </time>
            </div>
          ))}
          {query.hasNextPage && (
            <div className="p-4 text-center">
              <button className="btn-secondary" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
