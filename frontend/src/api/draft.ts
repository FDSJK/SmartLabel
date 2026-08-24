import { apiClient } from './client';
import type { Draft } from '../types/model';
import type { Shape } from '../types/shapes';

export const fetchDraft = (imageId: number) => apiClient.get<Draft>(`/images/${imageId}/draft`);
export const saveDraft = (imageId: number, shapes: Shape[]) =>
  apiClient.put<Draft>(`/images/${imageId}/draft`, { shapes });
export const acceptDraft = (imageId: number, expectedRev: number) =>
  apiClient.post<{ rev: number; shapes: Shape[]; labelStatus: Record<string, string> }>(
    `/images/${imageId}/draft/accept`, { expectedRev });
export const rejectDraft = (imageId: number) => apiClient.delete(`/images/${imageId}/draft`);
