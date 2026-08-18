import { apiClient } from './client';

export interface LabelStat {
  name: string;
  present: number;
  absent: number;
  pending: number;
}

export interface StatsResponse {
  totalImages: number;
  labels: LabelStat[];
}

export async function fetchStats(batchId?: number | null): Promise<StatsResponse> {
  const q = batchId != null ? `?batch_id=${batchId}` : '';
  return apiClient.get<StatsResponse>(`/stats${q}`);
}
