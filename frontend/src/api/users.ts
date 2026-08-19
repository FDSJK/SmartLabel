import { apiClient } from './client';
import type { User } from '../types/api';

export async function fetchUsers(): Promise<User[]> {
  return apiClient.get<User[]>('/users');
}

export async function fetchMe(): Promise<User> {
  return apiClient.get<User>('/users/me');
}

export async function updateMyWorkDir(workDir: string): Promise<User> {
  return apiClient.put<User>('/users/me/work_dir', { work_dir: workDir });
}

export async function createUser(data: { username: string; password: string }): Promise<User> {
  return apiClient.post<User>('/users', data);
}

export async function updateUser(id: number, data: { is_active?: boolean; password?: string }): Promise<User> {
  return apiClient.put<User>(`/users/${id}`, data);
}

export async function deleteUser(id: number): Promise<void> {
  return apiClient.delete(`/users/${id}`);
}
