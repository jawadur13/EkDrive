import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { timeAgo } from '../utils/format';

interface Notification {
  id: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

// Severity is shown with an icon and word, never color alone.
const SEVERITY = {
  info: { icon: 'ℹ', label: 'Info', className: 'text-blue-600' },
  warning: { icon: '⚠', label: 'Warning', className: 'text-amber-600' },
  error: { icon: '⛔', label: 'Problem', className: 'text-red-600' },
} as const;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r) => r.data as { items: Notification[]; unread: number }),
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const markAllRead = async () => {
    await api.post('/notifications/read', {});
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const unread = data?.unread ?? 0;

  return (
    <div className="relative" ref={panel}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all duration-200"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-[10px] font-bold leading-[18px] text-white text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] card shadow-lg z-40">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline">Mark all read</button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
            {(data?.items ?? []).length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">No notifications.</p>}
            {data?.items.map((n) => {
              const s = SEVERITY[n.severity] ?? SEVERITY.info;
              return (
                <div key={n.id} className={`px-4 py-3 ${n.read_at ? '' : 'bg-blue-50/40'}`}>
                  <div className="flex gap-2">
                    <span className={s.className} aria-label={s.label} title={s.label}>{s.icon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{n.title}</p>
                      {n.body && <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>}
                      <p className="mt-1 text-[11px] text-slate-400">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
