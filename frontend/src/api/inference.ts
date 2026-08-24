import { apiClient } from './client';
import type { InferenceJob } from '../types/model';

export const triggerInference = (modelId: number, imageId: number) =>
  apiClient.post<{ jobId: number }>(`/models/${modelId}/inference/${imageId}`);
export const triggerBatchInference = (modelId: number, batchId: number) =>
  apiClient.post<{ queued: number; jobIds: number[] }>(`/models/${modelId}/inference/batch/${batchId}`);
export const getJob = (jobId: number) => apiClient.get<InferenceJob>(`/inference-jobs/${jobId}`);
export const listJobs = (batchId: number) => apiClient.get<InferenceJob[]>(`/inference-jobs?batch_id=${batchId}`);
