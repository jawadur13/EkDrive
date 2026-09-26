import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export interface Drive {
  id: string;
  drive_name: string;
  google_email: string | null;
  total_quota_bytes: number | null;
  used_quota_bytes: number | null;
  available_quota_bytes: number | null;
  status: 'online' | 'degraded' | 'offline' | string;
  last_health_check: string | null;
}

export type StorageModeName = 'max_capacity' | 'balanced' | 'high_reliability';

export function useDrives() {
  return useQuery({
    queryKey: ['drives'],
    queryFn: () => api.get('/drives').then((r) => r.data.drives as Drive[]),
    refetchInterval: 60000,
  });
}

export function useStorageMode() {
  return useQuery({
    queryKey: ['storage-mode'],
    queryFn: () =>
      api.get('/storage-mode').then((r) => r.data as { mode: StorageModeName; minReplicas: number; rebalanceThreshold: number }),
  });
}
