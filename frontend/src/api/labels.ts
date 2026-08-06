import { apiClient } from './client';
import type { Label } from '../types/api';

export async function fetchLabels(): Promise<Label[]> {
  return apiClient.get<Label[]>('/labels');
}

export async function createLabel(data: { name: string; color: string }): Promise<Label> {
  return apiClient.post<Label>('/labels', data);
}

export async function updateLabel(id: number, data: Partial<Label>): Promise<Label> {
  return apiClient.put<Label>(`/labels/${id}`, data);
}

export async function deleteLabel(id: number): Promise<void> {
  await apiClient.delete(`/labels/${id}`);
}

export async function importLabelsTxt(content: string): Promise<Label[]> {
  return apiClient.post<Label[]>('/labels/import-txt', { content });
}
