import { apiClient } from './client';
import type { ModelConfig, ModelConfigInput } from '../types/model';

export const listModels = () => apiClient.get<ModelConfig[]>('/models');
export const createModel = (body: ModelConfigInput) => apiClient.post<ModelConfig>('/models', body);
export const updateModel = (id: number, body: ModelConfigInput) => apiClient.put<ModelConfig>(`/models/${id}`, body);
export const deleteModel = (id: number) => apiClient.delete(`/models/${id}`);
export const uploadModel = (file: File) => apiClient.uploadFile<{ filename: string }>('/models/upload', file);
