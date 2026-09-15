import { apiClient } from './client';
import type { ImageInfo } from '../types/api';

export async function fetchImages(batchId: number): Promise<ImageInfo[]> {
  return apiClient.get<ImageInfo[]>(`/batches/${batchId}/images`);
}

export async function fetchImage(id: number): Promise<ImageInfo> {
  return apiClient.get<ImageInfo>(`/images/${id}`);
}

export async function setImageFlag(id: number, flagged: boolean): Promise<{ flagged: boolean }> {
  return apiClient.put<{ flagged: boolean }>(`/images/${id}/flag`, { flagged });
}
