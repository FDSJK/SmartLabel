import { apiClient } from './client';
import type { TokenResponse } from '../types/api';

export async function loginApi(username: string, password: string): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>('/auth/login', { username, password });
}

export async function registerApi(username: string, password: string): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>('/auth/register', { username, password });
}
