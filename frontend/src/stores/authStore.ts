import { create } from 'zustand';

interface AuthState {
  user: { id: string; email: string; displayName: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
  setUser: (user: { id: string; email: string; displayName: string } | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {
    window.location.href = '/api/v1/auth/login';
  },
  logout: () => {
    document.cookie = 'access_token=; Max-Age=0; path=/; secure; samesite=strict';
    set({ user: null, isAuthenticated: false });
  },
  setUser: (user) => {
    set({ user, isAuthenticated: !!user, isLoading: false });
  },
}));