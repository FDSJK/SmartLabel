import { create } from 'zustand';
import { apiClient } from '../api/client';
import { loginApi, registerApi } from '../api/auth';
import { useBatchStore } from './batchStore';
import { useImageStore } from './imageStore';

interface AuthState {
  user: { username: string; role: string } | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const data = await loginApi(username, password);
      apiClient.setToken(data.access_token);
      localStorage.setItem('ling_token', data.access_token);
      localStorage.setItem('ling_user', JSON.stringify({ username: data.username, role: data.role }));
      set({
        user: { username: data.username, role: data.role },
        token: data.access_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  register: async (username, password) => {
    set({ isLoading: true });
    try {
      const data = await registerApi(username, password);
      apiClient.setToken(data.access_token);
      localStorage.setItem('ling_token', data.access_token);
      localStorage.setItem('ling_user', JSON.stringify({ username: data.username, role: data.role }));
      set({
        user: { username: data.username, role: data.role },
        token: data.access_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  logout: () => {
    apiClient.setToken(null);
    localStorage.removeItem('ling_token');
    localStorage.removeItem('ling_user');
    // 清空标注相关状态（批次、图像、画布、标注），避免切换账号后残留旧数据
    useBatchStore.getState().reset();
    useImageStore.getState().clearImage();
    set({ user: null, token: null, isAuthenticated: false });
  },

  restoreSession: () => {
    const token = localStorage.getItem('ling_token');
    const userStr = localStorage.getItem('ling_user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        apiClient.setToken(token);
        set({ user, token, isAuthenticated: true });
      } catch {
        localStorage.removeItem('ling_token');
        localStorage.removeItem('ling_user');
      }
    }
  },
}));
