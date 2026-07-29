import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export function useDriveHealth() {
  return useQuery({
    queryKey: ['drive-health'],
    queryFn: () => api.get('/api/v1/health/drives').then((r) => r.data),
    refetchInterval: 60000,
  });
}

export function useStorageMode() {
  return useQuery({
    queryKey: ['storage-mode'],
    queryFn: () => api.get('/api/v1/storage-mode').then((r) => r.data),
  });
}