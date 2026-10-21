import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type LiveEvent =
  | { type: 'ping' }
  | { type: 'notification' }
  | { type: 'files.changed' }
  | { type: 'drives.changed' }
  | { type: 'sync.finished' }
  | { type: 'rebalance.finished' };

// Which cached queries each event makes stale.
const AFFECTED: Record<string, string[]> = {
  notification: ['notifications'],
  'files.changed': ['files', 'search', 'recent-files', 'trash', 'analytics', 'file-issues'],
  'drives.changed': ['drives', 'analytics', 'drive-health-history', 'sync-status'],
  'sync.finished': ['file-issues', 'sync-conflicts', 'sync-status', 'files', 'notifications'],
  'rebalance.finished': ['analytics', 'drives', 'rebalance', 'file-issues', 'notifications'],
};

/**
 * Keeps the open page current without polling: the server pushes what changed, including
 * things the user did not start, like a background sync finding missing data. The browser
 * reconnects an EventSource on its own, so a backend restart heals itself.
 */
export function useLiveUpdates(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;

    const source = new EventSource('/api/v1/events', { withCredentials: true });

    source.onmessage = (message) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      for (const key of AFFECTED[event.type] ?? []) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    };

    return () => source.close();
  }, [enabled, queryClient]);
}
