import { apiClient, ApiError } from './client';

export type ExportScope = 'image' | 'batch' | 'all';
export type ExportFormat = 'mask' | 'coco' | 'labelme';

export interface ExportRequest {
  scope: ExportScope;
  imageId?: number | null;
  batchId?: number | null;
  formats: ExportFormat[];
  skipUnconfirmed?: boolean;
}

export interface PendingItem {
  image: string;
  labels: string[];
}

export interface ExportError {
  file: string;
  error: string;
}

export interface ExportResponse {
  exportDir: string;
  imageCount: number;
  annotationCount: number;
  maskCount: number;
  pending: PendingItem[];
  errors: ExportError[];
}

export function unconfirmedPending(err: unknown): PendingItem[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const detail = (err.body as { detail?: { code?: string; pending?: PendingItem[] } } | null)?.detail;
  if (detail && detail.code === 'unconfirmed_labels' && Array.isArray(detail.pending)) {
    return detail.pending;
  }
  return null;
}

export async function runExport(body: ExportRequest): Promise<ExportResponse> {
  return apiClient.post<ExportResponse>('/export', body);
}
