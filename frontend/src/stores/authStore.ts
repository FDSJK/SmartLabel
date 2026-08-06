import { create } from 'zustand';
import { apiClient } from '../api/client';
import type { TokenResponse } from '../types/api';

interface AuthState {
  token: string | null;
  user: { username: string; role: string } | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,

  login: async (username: string, password: string) => {
    const data = await apiClient.post<TokenResponse>('/auth/login', {
      username,
      password,
    });
    apiClient.setToken(data.access_token);
    localStorage.setItem('ling_token', data.access_token);
    localStorage.setItem('ling_user', JSON.stringify({ username: data.username, role: data.role }));
    set({ token: data.access_token, user: { username: data.username, role: data.role } });
  },

  register: async (username: string, password: string) => {
    const data = await apiClient.post<TokenResponse>('/auth/register', {
      username,
      password,
    });
    apiClient.setToken(data.access_token);
    localStorage.setItem('ling_token', data.access_token);
    localStorage.setItem('ling_user', JSON.stringify({ username: data.username, role: data.role }));
    set({ token: data.access_token, user: { username: data.username, role: data.role } });
  },

  logout: () => {
    apiClient.setToken(null);
    localStorage.removeItem('ling_token');
    localStorage.removeItem('ling_user');
    set({ token: null, user: null });
  },

  loadFromStorage: () => {
    const token = localStorage.getItem('ling_token');
    const userStr = localStorage.getItem('ling_user');
    if (token && userStr) {
      apiClient.setToken(token);
      set({ token, user: JSON.parse(userStr) });
    }
  },
}));
