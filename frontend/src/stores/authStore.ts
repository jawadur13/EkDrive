import { create } from 'zustand';
import api from '../services/api';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  storageMode: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  logout: async () => {
    // The cookie is HttpOnly, so only the server can clear it.
    await api.post('/auth/logout').catch(() => {});
    set({ user: null, isAuthenticated: false });
    window.location.href = '/login';
  },
  checkAuth: async () => {
    try {
      const res = await api.get('/auth/me');
      set({ user: res.data.user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
