import { apiClient } from './client';

export interface LockResponse {
  locked: boolean;
  locked_by_username: string;
}

export async function acquireLock(imageId: number): Promise<LockResponse> {
  return apiClient.post<LockResponse>(`/images/${imageId}/lock`);
}

export async function sendHeartbeat(imageId: number): Promise<void> {
  await apiClient.post(`/images/${imageId}/heartbeat`);
}

export async function releaseLock(imageId: number): Promise<void> {
  await apiClient.delete(`/images/${imageId}/lock`);
}
