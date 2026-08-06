import { apiClient } from './client';

export async function fetchSettings(): Promise<Record<string, string>> {
  return apiClient.get<Record<string, string>>('/settings');
}

export async function updateSetting(key: string, value: string): Promise<void> {
  await apiClient.put(`/settings/${key}`, { value });
}
