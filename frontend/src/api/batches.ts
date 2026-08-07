import { apiClient } from './client';
import type { Batch, ImageInfo } from '../types/api';

export async function fetchBatches(): Promise<Batch[]> {
  return apiClient.get<Batch[]>('/batches');
}

export async function createBatch(name: string): Promise<Batch> {
  return apiClient.post<Batch>('/batches', { name });
}

export async function scanBatches(): Promise<{ added: number; skipped: number; errors: unknown[] }> {
  return apiClient.post('/batches/scan');
}

export async function uploadImages(batchId: number, files: File[]): Promise<ImageInfo[]> {
  return apiClient.uploadFiles<ImageInfo[]>(`/batches/${batchId}/upload`, files);
}

export async function deleteBatch(batchId: number): Promise<void> {
  return apiClient.delete(`/batches/${batchId}`);
}
